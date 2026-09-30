const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Category = require('../src/models/Category');
const Equipment = require('../src/models/Equipment');
const EquipmentType = require('../src/models/EquipmentType');
const EquipmentAsset = require('../src/models/EquipmentAsset');
const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const Rental = require('../src/models/Rental');
const RentalReturn = require('../src/models/Return');
const ReturnConditionReport = require('../src/models/ReturnConditionReport');
const Cart = require('../src/models/Cart');
const PhoneOtpChallenge = require('../src/models/PhoneOtpChallenge');
const PasswordResetToken = require('../src/models/PasswordResetToken');
const ReservationHold = require('../src/models/ReservationHold');
const EquipmentBlockPeriod = require('../src/models/EquipmentBlockPeriod');
const MaintenanceRecord = require('../src/models/MaintenanceRecord');
const Payment = require('../src/models/Payment');
const Deposit = require('../src/models/Deposit');
const Refund = require('../src/models/Refund');
const LedgerEntry = require('../src/models/LedgerEntry');
const WebhookEvent = require('../src/models/WebhookEvent');
const RateLimitBucket = require('../src/models/RateLimitBucket');
const Delivery = require('../src/models/Delivery');
const DeliveryConditionReport = require('../src/models/DeliveryConditionReport');
const HandoverAcknowledgement = require('../src/models/HandoverAcknowledgement');
const { SearchProvider } = require('../src/services/search');
const { migrateLegacyInventory, toLegacyAsset, resolveLegacyEquipmentIds, syncAssetForLegacy } = require('../src/services/inventory');
const { assertAvailable } = require('../src/services/availability');
const { postLedgerEntry } = require('../src/services/ledger');
const idempotency = require('../src/middleware/idempotency');
const rateLimit = require('../src/middleware/rateLimit');
const { issueRefund } = require('../src/services/refunds');
const { finalizeCapturedPayment } = require('../src/services/paymentLifecycle');
const { resolveProviderRefund } = require('../src/services/bookingFinance');
const { verifyCheckoutSignature, verifyWebhookSignature, createOrRecoverOrder } = require('../src/services/razorpay');
const app = require('../src/app');
const { attachSocketServer } = require('../src/sockets');

let mongoServer;

test.before(async () => {
  if (process.env.TEST_MONGODB_URI) {
    await mongoose.connect(process.env.TEST_MONGODB_URI);
  } else {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'rentalhub-tests' });
  }
});

test.after(async () => {
  if (!mongoServer && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(() => rateLimit.resetMemoryBuckets());

test('delivery lifecycle enforces valid transitions and records a condition report', async () => {
  const owner = await User.create({ name: 'Delivery Owner', email: `delivery-owner-${crypto.randomUUID()}@example.com`, password: 'Owner@123', role: 'owner' });
  const customer = await User.create({ name: 'Delivery Customer', email: `delivery-customer-${crypto.randomUUID()}@example.com`, password: 'Customer@123', role: 'customer' });
  const transporter = await User.create({ name: 'Delivery Driver', email: `delivery-driver-${crypto.randomUUID()}@example.com`, password: 'Driver@123', role: 'transporter' });
  const category = await Category.create({ name: 'Delivery Test', slug: 'delivery-test', description: 'Delivery test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Delivery Unit',
    description: 'Delivery test equipment',
    dailyRate: 150,
    replacementValue: 2000,
    depositAmount: 200,
    location: { city: 'Bengaluru' },
    status: 'available',
    active: true
  });
  process.env.JWT_SECRET = 'delivery-lifecycle-test-secret-32-chars';

  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 150,
    depositAmount: 200,
    totalAmount: 350,
    status: 'confirmed'
  });

  const rental = await Rental.create({
    booking: booking._id,
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: booking.startDate,
    endDate: booking.endDate,
    rentalDays: booking.rentalDays,
    pricing: { rentalSubtotal: booking.subtotal, securityDeposit: booking.depositAmount, grandTotal: booking.totalAmount },
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  });
  booking.rental = rental._id;
  await booking.save();

  const delivery = await Delivery.create({
    rental: rental._id,
    booking: booking._id,
    equipment: equipment._id,
    customer: customer._id,
    owner: owner._id,
    transporter: transporter._id,
    address: '12 Test Street, Bengaluru',
    status: 'ASSIGNED'
  });

  booking.delivery = delivery._id;
  await booking.save();

  const token = jwt.sign({ sub: String(transporter._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const invalid = await fetch(`${baseUrl}/api/deliveries/${delivery._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'DELIVERED' })
    });
    assert.equal(invalid.status, 409);

    const accept = await fetch(`${baseUrl}/api/deliveries/${delivery._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'ACCEPTED' })
    });
    assert.equal(accept.status, 200);

    const report = await fetch(`${baseUrl}/api/deliveries/${delivery._id}/condition-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        overallCondition: 'GOOD',
        checklist: { scratches: 'left side panel', dents: 'none', notes: 'Ready for handover' },
        photos: [{ type: 'front', url: 'https://example.com/front.jpg' }],
        existingDamage: 'Minor bumper scuff',
        accessoriesIncluded: ['helmet', 'charger'],
        notes: 'Equipment verified before handover.'
      })
    });
    assert.equal(report.status, 201);
    const reportJson = await report.json();
    assert.equal(reportJson.data.delivery, String(delivery._id));
    assert.ok(reportJson.data.checklist);

    const acknowledgement = await fetch(`${baseUrl}/api/deliveries/${delivery._id}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ customerAck: true, transporterAck: true })
    });
    assert.equal(acknowledgement.status, 200);
    const ackJson = await acknowledgement.json();
    assert.ok(ackJson.data.customerAcknowledged || ackJson.data.transporterAcknowledged);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('EquipmentType and EquipmentAsset are distinct inventory models', async () => {
  const owner = await User.create({ name: 'Inventory Owner', email: 'owner-test@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Construction', slug: 'construction', description: 'Construction gear' });
  const equipmentType = await EquipmentType.create({
    category: category._id,
    typeCode: 'DRILL-01',
    name: 'Impact Drill',
    slug: 'impact-drill',
    description: 'Cordless impact drill for concrete and metal',
    aliases: ['drill machine', 'impact driver', 'इं pact ड्रिल'],
    searchTerms: ['drilling', 'masonry', 'woodwork'],
    taskTerms: ['drill holes', 'drive screws', 'anchor masonry'],
    defaultDailyRate: 2200,
    imageUrls: ['https://example.com/drill.jpg'],
    specs: [{ key: 'power', value: '18V', unit: 'V' }]
  });

  const asset = await EquipmentAsset.create({
    assetId: 'ASSET-DRILL-001',
    equipmentType: equipmentType._id,
    owner: owner._id,
    organization: 'Bharat Rentals',
    serialNumber: 'SER-DRILL-1',
    qrCode: 'QR-DRILL-1',
    status: 'available',
    condition: 'excellent',
    lifecycleState: 'listed',
    dailyRate: 2200,
    replacementValue: 35000,
    depositAmount: 5000,
    location: {
      type: 'Point',
      coordinates: [77.5946, 12.9716],
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      pincode: '560001',
      country: 'India',
      formatted: 'Bengaluru, Karnataka'
    }
  });

  assert.equal(String(asset.equipmentType), String(equipmentType._id));
  assert.equal(String(asset.owner), String(owner._id));

  const result = await SearchProvider.query({ q: 'drill', category: 'construction', city: 'Bengaluru', page: 1, limit: 10 });
  assert.ok(result.items.some((item) => String(item._id) === String(asset._id)));
});

test('Legacy inventory compatibility keeps adapter output and migration idempotent', async () => {
  const owner = await User.create({ name: 'Legacy Owner', email: 'legacy@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Lighting', slug: 'lighting', description: 'Lights and staging units' });
  const legacyEquipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'LED Panel 200W',
    description: 'Bright LED panel for studio and events',
    brand: 'Aputure',
    dailyRate: 1800,
    replacementValue: 22000,
    depositAmount: 3000,
    location: { city: 'Mumbai', region: 'Maharashtra' },
    images: ['https://example.com/panel.jpg'],
    condition: 'good',
    status: 'available',
    active: true,
    swapTypes: ['item_for_item']
  });

  await migrateLegacyInventory();
  const asset = await EquipmentAsset.findOne({ assetId: `legacy-${String(legacyEquipment._id)}` });
  assert.ok(asset, 'legacy item should migrate into an asset record');

  const legacyView = await toLegacyAsset(asset);
  assert.equal(legacyView.name, 'LED Panel 200W');
  assert.equal(legacyView.status, 'available');
  assert.equal(String(legacyView.category._id || legacyView.category), category._id.toString());
  assert.equal(String(legacyView._id), legacyEquipment._id.toString());
  assert.deepEqual(await resolveLegacyEquipmentIds([asset._id]), [legacyEquipment._id.toString()]);
  legacyEquipment.dailyRate = 1900;
  await legacyEquipment.save();
  const syncedAsset = await syncAssetForLegacy(legacyEquipment);
  assert.equal(syncedAsset.dailyRate, 1900);
  assert.equal(String(syncedAsset.legacyEquipment), legacyEquipment._id.toString());

  const secondMigration = await migrateLegacyInventory();
  assert.equal(secondMigration, undefined);
});

test('availability counts quantities and maintenance blocks across overlapping dates', async () => {
  const owner = await User.create({ name: 'Availability Owner', email: 'availability-owner@example.com', password: 'Owner@123', role: 'owner' });
  const customer = await User.create({ name: 'Availability Customer', email: 'availability-customer@example.com', password: 'Customer@123', role: 'customer' });
  const category = await Category.create({ name: 'Availability Test', slug: 'availability-test', description: 'Availability test category' });
  const equipment = await Promise.all(['Reserved Item', 'Free Item'].map((name) => Equipment.create({
    owner: owner._id,
    category: category._id,
    name,
    description: name,
    dailyRate: 100,
    replacementValue: 1000,
    depositAmount: 100,
    location: { city: 'Chennai' },
    quantity: 3
  })));
  const start = new Date(Date.now() + 3 * 86400000);
  const end = new Date(Date.now() + 4 * 86400000);
  await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment[0]._id],
    equipmentQuantities: [{ equipment: equipment[0]._id, quantity: 2 }],
    startDate: start,
    endDate: end,
    rentalDays: 1,
    subtotal: 100,
    depositAmount: 100,
    totalAmount: 200,
    status: 'confirmed'
  });

  await assert.doesNotReject(() => assertAvailable([equipment[0]._id], start, end, undefined, [
    { equipment: equipment[0]._id, quantity: 1 }
  ]));
  await assert.rejects(
    () => assertAvailable([equipment[0]._id], start, end, undefined, [
      { equipment: equipment[0]._id, quantity: 2 }
    ]),
    { errorCode: 'DATES_UNAVAILABLE' }
  );
  await assert.doesNotReject(() => assertAvailable([equipment[1]._id], start, end));

  const block = await EquipmentBlockPeriod.create({
    equipment: equipment[0]._id,
    createdBy: owner._id,
    startDate: start,
    endDate: end,
    quantity: 1,
    type: 'MAINTENANCE',
    reason: 'Scheduled service'
  });
  try {
    await assert.rejects(
      () => assertAvailable([equipment[0]._id], start, end, undefined, [
        { equipment: equipment[0]._id, quantity: 1 }
      ]),
      { errorCode: 'DATES_UNAVAILABLE' }
    );
  } finally {
    await EquipmentBlockPeriod.deleteOne({ _id: block._id });
  }
});

test('owners create date-bounded stock blocks and non-owners cannot manage them', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'equipment-block-test-secret-at-least-32-characters';
  const owner = await User.create({
    name: 'Block Owner', email: `block-owner-${crypto.randomUUID()}@example.com`,
    password: 'BlockOwner@123', role: 'owner', ownerVerified: true
  });
  const customer = await User.create({
    name: 'Block Customer', email: `block-customer-${crypto.randomUUID()}@example.com`,
    password: 'BlockCustomer@123', role: 'customer'
  });
  const category = await Category.create({ name: `Block ${crypto.randomUUID()}`, slug: `block-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({
    owner: owner._id, category: category._id, name: 'Blockable Stock', description: 'Stock block test',
    dailyRate: 100, replacementValue: 1000, depositAmount: 100, quantity: 2,
    location: { city: 'Chennai' }
  });
  await syncAssetForLegacy(equipment);
  const ownerToken = jwt.sign({ sub: owner.id, role: owner.role, ver: owner.tokenVersion }, process.env.JWT_SECRET);
  const customerToken = jwt.sign({ sub: customer.id, role: customer.role, ver: customer.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startDate = new Date(Date.now() + 5 * 86400000).toISOString();
  const endDate = new Date(Date.now() + 6 * 86400000).toISOString();
  try {
    const created = await fetch(`${baseUrl}/api/owner/equipment/${equipment.id}/blocks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ startDate, endDate, quantity: 1, type: 'MAINTENANCE', reason: 'Scheduled service' })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    assert.equal(createdBody.data.type, 'MAINTENANCE');
    assert.equal(createdBody.data.quantity, 1);

    await assert.doesNotReject(() => assertAvailable([equipment._id], new Date(startDate), new Date(endDate), undefined, [
      { equipment: equipment._id, quantity: 1 }
    ]));
    await assert.rejects(() => assertAvailable([equipment._id], new Date(startDate), new Date(endDate), undefined, [
      { equipment: equipment._id, quantity: 2 }
    ]), { errorCode: 'DATES_UNAVAILABLE' });

    const forbidden = await fetch(`${baseUrl}/api/owner/equipment/${equipment.id}/blocks`, {
      headers: { authorization: `Bearer ${customerToken}` }
    });
    assert.equal(forbidden.status, 403);
    const listed = await fetch(`${baseUrl}/api/owner/equipment/${equipment.id}/blocks`, {
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal((await listed.json()).data.length, 1);
  } finally {
    await EquipmentBlockPeriod.deleteMany({ equipment: equipment._id });
    await EquipmentAsset.deleteMany({ legacyEquipment: equipment._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: [owner._id, customer._id] } });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('maintenance records block inventory until service completion', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'maintenance-test-secret-at-least-32-characters';
  const owner = await User.create({
    name: 'Maintenance Owner', email: `maintenance-owner-${crypto.randomUUID()}@example.com`,
    password: 'MaintenanceOwner@123', role: 'owner'
  });
  const category = await Category.create({ name: `Maintenance ${crypto.randomUUID()}`, slug: `maintenance-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({
    owner: owner._id, category: category._id, name: 'Serviceable Stock', description: 'Maintenance availability test',
    dailyRate: 100, replacementValue: 1000, depositAmount: 50, quantity: 2,
    location: { city: 'Pune' }
  });
  await syncAssetForLegacy(equipment);
  const token = jwt.sign({ sub: owner.id, role: owner.role, ver: owner.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startDate = new Date(Date.now() + 5 * 86400000).toISOString();
  const endDate = new Date(Date.now() + 6 * 86400000).toISOString();
  let recordId;
  try {
    const created = await fetch(`${baseUrl}/api/maintenance/equipment/${equipment.id}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ startDate, endDate, type: 'repair', quantity: 1, notes: 'Replace worn coupling' })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    recordId = createdBody.data._id;
    assert.equal(await MaintenanceRecord.countDocuments({ _id: recordId, status: 'SCHEDULED' }), 1);
    await assert.doesNotReject(() => assertAvailable([equipment._id], new Date(startDate), new Date(endDate), undefined, [
      { equipment: equipment._id, quantity: 1 }
    ]));
    await assert.rejects(() => assertAvailable([equipment._id], new Date(startDate), new Date(endDate), undefined, [
      { equipment: equipment._id, quantity: 2 }
    ]), { errorCode: 'DATES_UNAVAILABLE' });

    const started = await fetch(`${baseUrl}/api/maintenance/${recordId}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ status: 'IN_PROGRESS', meterReading: '128.5 hours' })
    });
    assert.equal(started.status, 200);
    const completed = await fetch(`${baseUrl}/api/maintenance/${recordId}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ status: 'COMPLETED', cost: 750, serviceDate: new Date().toISOString() })
    });
    assert.equal(completed.status, 200);
    assert.equal((await MaintenanceRecord.findById(recordId)).status, 'COMPLETED');
    await assert.doesNotReject(() => assertAvailable([equipment._id], new Date(startDate), new Date(endDate), undefined, [
      { equipment: equipment._id, quantity: 2 }
    ]));
  } finally {
    if (recordId) await MaintenanceRecord.deleteOne({ _id: recordId });
    await EquipmentBlockPeriod.deleteMany({ equipment: equipment._id });
    await EquipmentAsset.deleteMany({ legacyEquipment: equipment._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteOne({ _id: owner._id });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('customer return completes only after delivery comparison, return inspection, and deposit disposition', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'rental-return-test-secret-at-least-32-characters';
  const owner = await User.create({ name: 'Return Owner', email: `return-owner-${crypto.randomUUID()}@example.com`, password: 'ReturnOwner@123', role: 'owner' });
  const customer = await User.create({ name: 'Return Customer', email: `return-customer-${crypto.randomUUID()}@example.com`, password: 'ReturnCustomer@123', role: 'customer' });
  const transporter = await User.create({ name: 'Return Transporter', email: `return-transporter-${crypto.randomUUID()}@example.com`, password: 'ReturnTransporter@123', role: 'transporter' });
  const category = await Category.create({ name: `Return ${crypto.randomUUID()}`, slug: `return-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({
    owner: owner._id, category: category._id, name: 'Return Lifecycle Equipment', description: 'Return comparison fixture',
    dailyRate: 100, replacementValue: 1000, depositAmount: 200, location: { city: 'Chennai' }
  });
  await syncAssetForLegacy(equipment);
  const booking = await Booking.create({
    customer: customer._id, owner: owner._id, equipment: [equipment._id],
    startDate: new Date(Date.now() - 2 * 86400000), endDate: new Date(Date.now() + 2 * 86400000),
    rentalDays: 4, subtotal: 400, depositAmount: 200, totalAmount: 600, status: 'in_progress'
  });
  const rental = await Rental.create({
    booking: booking._id, customer: customer._id, owner: owner._id, equipment: [equipment._id],
    startDate: booking.startDate, endDate: booking.endDate, rentalDays: booking.rentalDays,
    pricing: { rentalSubtotal: booking.subtotal, securityDeposit: booking.depositAmount, grandTotal: booking.totalAmount },
    status: 'ACTIVE', paymentStatus: 'PAID'
  });
  booking.rental = rental._id;
  await booking.save();
  const delivery = await Delivery.create({
    rental: rental._id, booking: booking._id, equipment: equipment._id, customer: customer._id,
    owner: owner._id, address: '4 Return Road, Chennai', status: 'DELIVERED'
  });
  const deliveryReport = await DeliveryConditionReport.create({
    delivery: delivery._id, rental: rental._id, equipment: equipment._id, owner: owner._id,
    customer: customer._id, transporter: transporter._id, overallCondition: 'GOOD', conditionStatus: 'GOOD',
    checklist: { scratches: 'none', meterReading: '100 hours' }
  });
  delivery.conditionReport = deliveryReport._id;
  delivery.serviceType = 'delivery';
  await delivery.save();
  const deposit = await Deposit.create({ booking: booking._id, customer: customer._id, amount: 200, status: 'refunded' });
  const customerToken = jwt.sign({ sub: customer.id, role: customer.role, ver: customer.tokenVersion }, process.env.JWT_SECRET);
  const ownerToken = jwt.sign({ sub: owner.id, role: owner.role, ver: owner.tokenVersion }, process.env.JWT_SECRET);
  const transporterToken = jwt.sign({ sub: transporter.id, role: transporter.role, ver: transporter.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let returnId;
  async function request(path, token, method = 'GET', body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { response, body: await response.json() };
  }
  try {
    const requested = await request(`/api/returns/rentals/${rental.id}/request`, customerToken, 'POST', {});
    assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
    returnId = requested.body.data._id;
    assert.equal(requested.body.data.status, 'RETURN_ASSIGNED');
    assert.equal((await Rental.findById(rental._id)).status, 'RETURN_PENDING');
    assert.equal((await Booking.findById(booking._id)).status, 'return_pending');

    const assignment = await request(`/api/deliveries/${delivery.id}/assign`, ownerToken, 'POST', { transporterId: String(transporter._id) });
    assert.equal(assignment.response.status, 200, JSON.stringify(assignment.body));
    assert.equal(assignment.body.data.status, 'RETURN_PICKUP_PENDING');

    for (const status of ['RETURN_PICKED_UP', 'RETURN_IN_TRANSIT', 'RETURN_ARRIVED', 'RETURN_INSPECTION']) {
      const updated = await request(`/api/deliveries/${delivery.id}/status`, transporterToken, 'PATCH', { status });
      assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    }
    assert.equal((await RentalReturn.findById(returnId)).status, 'RETURN_INSPECTION');

    const report = await request(`/api/returns/${returnId}/inspection`, ownerToken, 'POST', {
      equipmentId: String(equipment._id),
      condition: 'FAIR',
      checklist: { scratches: 'new surface scratches', meterReading: '120 hours' },
      damage: 'New scratches observed; cause undetermined.'
    });
    assert.equal(report.response.status, 201, JSON.stringify(report.body));
    assert.equal(String(report.body.data.conditionAtDelivery), String(deliveryReport._id));

    const completed = await request(`/api/returns/${returnId}/complete`, ownerToken, 'POST', {});
    assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
    assert.equal((await RentalReturn.findById(returnId)).status, 'RETURN_COMPLETED');
    assert.equal((await Rental.findById(rental._id)).status, 'COMPLETED');
    assert.equal((await Booking.findById(booking._id)).status, 'completed');
    assert.equal((await Delivery.findById(delivery._id)).status, 'RETURN_COMPLETED');
    const review = await request(`/api/bookings/${booking._id}/reviews`, customerToken, 'POST', { rating: 5, comment: 'Equipment returned after inspection.' });
    assert.equal(review.response.status, 201, JSON.stringify(review.body));
    assert.equal(String(review.body.data.owner), String(owner._id));
    const duplicateReview = await request(`/api/bookings/${booking._id}/reviews`, customerToken, 'POST', { rating: 4 });
    assert.equal(duplicateReview.response.status, 409);
  } finally {
    if (returnId) {
      await ReturnConditionReport.deleteMany({ returnRecord: returnId });
      await RentalReturn.deleteOne({ _id: returnId });
    }
    await DeliveryConditionReport.deleteOne({ _id: deliveryReport._id });
    await Delivery.deleteOne({ _id: delivery._id });
    await Deposit.deleteOne({ _id: deposit._id });
    await Booking.deleteOne({ _id: booking._id });
    await Rental.deleteOne({ _id: rental._id });
    await EquipmentAsset.deleteMany({ legacyEquipment: equipment._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: [owner._id, customer._id, transporter._id] } });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('rental disputes persist participant responses and require admin resolution', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'dispute-test-secret-at-least-32-characters-long';
  const owner = await User.create({ name: 'Dispute Owner', email: `dispute-owner-${crypto.randomUUID()}@example.com`, password: 'DisputeOwner@123', role: 'owner' });
  const customer = await User.create({ name: 'Dispute Customer', email: `dispute-customer-${crypto.randomUUID()}@example.com`, password: 'DisputeCustomer@123', role: 'customer' });
  const outsider = await User.create({ name: 'Dispute Outsider', email: `dispute-outsider-${crypto.randomUUID()}@example.com`, password: 'DisputeOutsider@123', role: 'customer' });
  const admin = await User.create({ name: 'Dispute Admin', email: `dispute-admin-${crypto.randomUUID()}@example.com`, password: 'DisputeAdmin@123', role: 'admin' });
  const category = await Category.create({ name: `Dispute ${crypto.randomUUID()}`, slug: `dispute-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({
    owner: owner._id, category: category._id, name: 'Disputed Equipment', description: 'Dispute integration item',
    dailyRate: 100, replacementValue: 1000, depositAmount: 50, location: { city: 'Chennai' }
  });
  const startDate = new Date(Date.now() + 4 * 86400000);
  const endDate = new Date(Date.now() + 6 * 86400000);
  const booking = await Booking.create({
    customer: customer._id, owner: owner._id, equipment: [equipment._id], startDate, endDate,
    rentalDays: 2, subtotal: 200, depositAmount: 50, totalAmount: 250, status: 'confirmed'
  });
  const rental = await Rental.create({
    booking: booking._id, customer: customer._id, owner: owner._id, equipment: [equipment._id],
    startDate, endDate, rentalDays: 2,
    pricing: { rentalSubtotal: 200, securityDeposit: 50, grandTotal: 250 },
    status: 'ACTIVE', paymentStatus: 'PAID'
  });
  booking.rental = rental._id;
  await booking.save();
  const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, ver: user.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, method = 'GET', body) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const customerToken = tokenFor(customer);
  const ownerToken = tokenFor(owner);
  const outsiderToken = tokenFor(outsider);
  const adminToken = tokenFor(admin);
  let disputeId;
  try {
    const created = await request('/api/disputes', customerToken, 'POST', {
      rentalId: String(rental._id),
      equipmentId: String(equipment._id),
      disputeType: 'damage',
      summary: 'Visible damage was present at handover',
      notes: 'Please review the uploaded evidence.'
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    disputeId = createdBody.data._id;
    assert.equal((await Rental.findById(rental._id)).status, 'DISPUTED');

    const outsiderRead = await request(`/api/disputes/${disputeId}`, outsiderToken);
    assert.equal(outsiderRead.status, 403);
    const ownerResponse = await request(`/api/disputes/${disputeId}/responses`, ownerToken, 'POST', { message: 'We will review the condition report.' });
    assert.equal(ownerResponse.status, 201);
    const ownerView = await request(`/api/disputes/${disputeId}`, ownerToken);
    assert.equal((await ownerView.json()).data.responses[0].message, 'We will review the condition report.');

    const customerResolve = await request(`/api/disputes/${disputeId}/status`, customerToken, 'PATCH', { status: 'resolved', resolution: 'Reviewed' });
    assert.equal(customerResolve.status, 403);
    const adminReview = await request(`/api/disputes/${disputeId}/status`, adminToken, 'PATCH', { status: 'under_review' });
    assert.equal(adminReview.status, 200);
    const adminResolve = await request(`/api/disputes/${disputeId}/status`, adminToken, 'PATCH', { status: 'resolved', resolution: 'Evidence reviewed by support.' });
    assert.equal(adminResolve.status, 200);
    const storedDispute = await DeliveryIssue.findById(disputeId);
    assert.equal(storedDispute.status, 'resolved');
    assert.equal(storedDispute.resolution, 'Evidence reviewed by support.');
    assert.equal((await Rental.findById(rental._id)).status, 'ACTIVE');
  } finally {
    if (disputeId) await DeliveryIssue.deleteOne({ _id: disputeId });
    await Rental.deleteOne({ _id: rental._id });
    await Booking.deleteOne({ _id: booking._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: [owner._id, customer._id, outsider._id, admin._id] } });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('customer quantity hold becomes a priced booking and cancellation remains auditable', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'quantity-booking-test-secret-at-least-32-characters';
  const owner = await User.create({
    name: 'Quantity Owner', email: `quantity-owner-${crypto.randomUUID()}@example.com`,
    password: 'QuantityOwner@123', role: 'owner', ownerVerified: true
  });
  const customer = await User.create({
    name: 'Quantity Customer', email: `quantity-customer-${crypto.randomUUID()}@example.com`,
    password: 'QuantityCustomer@123', role: 'customer'
  });
  const category = await Category.create({ name: `Quantity ${crypto.randomUUID()}`, slug: `quantity-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({
    owner: owner._id, category: category._id, name: 'Quantity Stock', description: 'Quantity booking integration test',
    dailyRate: 100, replacementValue: 1000, depositAmount: 50, quantity: 5,
    location: { city: 'Chennai' }
  });
  await syncAssetForLegacy(equipment);
  const token = jwt.sign({ sub: customer.id, role: customer.role, ver: customer.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startDate = new Date(Date.now() + 5 * 86400000).toISOString();
  const endDate = new Date(Date.now() + 7 * 86400000).toISOString();
  let holdId;
  let bookingId;
  try {
    const holdResponse = await fetch(`${baseUrl}/api/bookings/holds`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ startDate, endDate, items: [{ equipmentId: String(equipment._id), quantity: 2 }] })
    });
    const holdBody = await holdResponse.json();
    assert.equal(holdResponse.status, 201, JSON.stringify(holdBody));
    holdId = holdBody.data._id;
    assert.equal(holdBody.data.equipmentQuantities[0].quantity, 2);

    const bookingResponse = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ holdId, address: '12 Market Road, Chennai, Tamil Nadu' })
    });
    const bookingBody = await bookingResponse.json();
    assert.equal(bookingResponse.status, 201, JSON.stringify(bookingBody));
    bookingId = bookingBody.data.booking._id;
    assert.equal(bookingBody.data.booking.equipmentQuantities[0].quantity, 2);
    assert.equal(bookingBody.data.booking.rentalDays, 2);
    assert.equal(bookingBody.data.booking.subtotal, 400);
    assert.equal(bookingBody.data.booking.depositAmount, 100);
    assert.equal(bookingBody.data.booking.totalAmount, 500);
    assert.ok(await require('../src/models/Notification').exists({ user: owner._id, type: 'booking_created' }));

    const overbooked = await fetch(`${baseUrl}/api/bookings/holds`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ startDate, endDate, items: [{ equipmentId: String(equipment._id), quantity: 4 }] })
    });
    assert.equal(overbooked.status, 409);
    assert.equal((await overbooked.json()).errorCode, 'DATES_UNAVAILABLE');

    const cancelled = await fetch(`${baseUrl}/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ reason: 'Project dates changed' })
    });
    const cancelledBody = await cancelled.json();
    assert.equal(cancelled.status, 200, JSON.stringify(cancelledBody));
    const storedBooking = await Booking.findById(bookingId);
    assert.equal(storedBooking.status, 'cancelled');
    assert.equal(storedBooking.cancellationReason, 'Project dates changed');
    assert.equal(String(storedBooking.cancelledBy), String(customer._id));
    assert.ok(storedBooking.cancelledAt);
  } finally {
    if (bookingId) {
      await Booking.deleteOne({ _id: bookingId });
      await Delivery.deleteMany({ booking: bookingId });
      await require('../src/models/Notification').deleteMany({ 'metadata.bookingId': String(bookingId) });
    }
    if (holdId) await ReservationHold.deleteOne({ _id: holdId });
    await EquipmentAsset.deleteMany({ legacyEquipment: equipment._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: [owner._id, customer._id] } });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('Search and readiness routes are mounted with safe compatibility responses', async () => {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthJson = await health.json();
    assert.equal(healthJson.success, true);

    const search = await fetch(`http://127.0.0.1:${port}/api/v1/search?q=drill&limit=5`);
    const searchJson = await search.json();
    assert.equal(searchJson.success, true);
    assert.ok(searchJson.data && searchJson.data.pagination);

    const compatibleSearch = await fetch(`http://127.0.0.1:${port}/api/equipment?q=drill&limit=5`);
    const compatibleJson = await compatibleSearch.json();
    assert.equal(compatibleJson.success, true);
    assert.ok(compatibleJson.data.items.every((item) => item._id && item.category && item.dailyRate >= 0));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('database-driven catalog exposes products and counts, with admin-only CRUD and inactive-category filtering', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldRateLimitStore = process.env.RATE_LIMIT_STORE;
  process.env.JWT_SECRET = 'catalog-test-secret-at-least-32-characters-long';
  process.env.RATE_LIMIT_STORE = 'mongodb';
  const admin = await User.create({
    name: 'Catalog Admin',
    email: `catalog-admin-${crypto.randomUUID()}@example.com`,
    password: 'CatalogAdmin@123',
    role: 'admin'
  });
  const customer = await User.create({
    name: 'Catalog Customer',
    email: `catalog-customer-${crypto.randomUUID()}@example.com`,
    password: 'CatalogCustomer@123',
    role: 'customer'
  });
  const adminToken = jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const customerToken = jwt.sign({ sub: String(customer._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', token, body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { response, body: await response.json() };
  };
  try {
    const createdCategory = await request('/api/admin/categories', {
      method: 'POST', token: adminToken, body: { name: 'Catalog QA Tools', description: 'Database-backed test category' }
    });
    assert.equal(createdCategory.response.status, 201);
    const category = createdCategory.body.data;
    const updatedCategory = await request(`/api/admin/categories/${category._id}`, {
      method: 'PATCH', token: adminToken, body: { description: 'Updated database-backed category' }
    });
    assert.equal(updatedCategory.response.status, 200);
    const productIds = [];
    for (let index = 0; index < 10; index += 1) {
      const createdProduct = await request('/api/admin/equipment-types', {
        method: 'POST',
        token: adminToken,
        body: { category: category._id, name: `Catalog QA Product ${index + 1}`, description: 'Test catalog product' }
      });
      assert.equal(createdProduct.response.status, 201);
      productIds.push(createdProduct.body.data._id);
    }
    const publicCategories = await request('/api/categories');
    const publicCategory = publicCategories.body.data.find((entry) => entry.slug === category.slug);
    assert.equal(publicCategory.productCount, 10);
    assert.equal(publicCategory.availableListingCount, 0);
    const detail = await request(`/api/categories/${category.slug}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.products.length, 10);
    assert.equal(detail.body.data.products[0].availableListingCount, 0);

    const owner = await User.create({
      name: 'Catalog Inventory Owner',
      email: `catalog-owner-${crypto.randomUUID()}@example.com`,
      password: 'CatalogOwner@123',
      role: 'owner'
    });
    const asset = await EquipmentAsset.create({
      assetId: `CATALOG-QA-${crypto.randomUUID()}`,
      equipmentType: productIds[0],
      owner: owner._id,
      name: 'Available Catalog QA Product',
      status: 'available',
      active: true,
      dailyRate: 100,
      location: { city: 'Chennai' }
    });
    const updatedDetail = await request(`/api/categories/${category.slug}`);
    assert.equal(updatedDetail.body.data.availableListingCount, 1);
    assert.equal(updatedDetail.body.data.products.find((product) => String(product._id) === String(productIds[0])).availableListingCount, 1);
    const filteredListings = await request(`/api/equipment?category=${category.slug}`);
    assert.ok(filteredListings.body.data.items.some((item) => String(item._id) === String(asset._id)));

    const editedProduct = await request(`/api/admin/equipment-types/${productIds[1]}`, {
      method: 'PATCH', token: adminToken, body: { description: 'Updated product description' }
    });
    assert.equal(editedProduct.response.status, 200);
    assert.equal(editedProduct.body.data.description, 'Updated product description');
    const forbiddenEdit = await request(`/api/admin/equipment-types/${productIds[1]}`, {
      method: 'PATCH', token: customerToken, body: { description: 'Unauthorized' }
    });
    assert.equal(forbiddenEdit.response.status, 403);
    const blockedDeactivation = await request(`/api/admin/equipment-types/${productIds[0]}`, {
      method: 'DELETE', token: adminToken
    });
    assert.equal(blockedDeactivation.response.status, 409);

    const deactivatedCategory = await request(`/api/admin/categories/${category._id}`, {
      method: 'DELETE', token: adminToken
    });
    assert.equal(deactivatedCategory.response.status, 200);
    assert.equal((await request(`/api/categories/${category.slug}`)).response.status, 404);
    const categorySearch = await request(`/api/equipment?category=${category.slug}`);
    assert.equal(categorySearch.body.data.items.length, 0);
    const reactivatedCategory = await request(`/api/admin/categories/${category._id}`, {
      method: 'PATCH', token: adminToken, body: { active: true }
    });
    assert.equal(reactivatedCategory.response.status, 200);

    asset.active = false;
    await asset.save();
    const deactivatedProduct = await request(`/api/admin/equipment-types/${productIds[0]}`, {
      method: 'DELETE', token: adminToken
    });
    assert.equal(deactivatedProduct.response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await RateLimitBucket.deleteMany({});
    process.env.JWT_SECRET = oldSecret;
    if (oldRateLimitStore === undefined) delete process.env.RATE_LIMIT_STORE;
    else process.env.RATE_LIMIT_STORE = oldRateLimitStore;
  }
});

test('catalog search matches Hindi and Tamil names/aliases and normalizes Unicode input', async () => {
  const category = await Category.create({
    name: 'மின் உபகரணங்கள்',
    slug: `multilingual-${crypto.randomUUID()}`,
    names: [
      { lang: 'en', value: 'Power Equipment' },
      { lang: 'hi', value: 'बिजली के उपकरण' },
      { lang: 'ta', value: 'மின் உபகரணங்கள்' }
    ],
    aliases: ['बिजली के उपकरण', 'மின் உபகரணங்கள்']
  });
  const owner = await User.create({
    name: 'Multilingual Catalog Owner',
    email: `multilingual-owner-${crypto.randomUUID()}@example.com`,
    password: 'CatalogOwner@123',
    role: 'owner'
  });
  const product = await EquipmentType.create({
    category: category._id,
    name: 'Portable Generator',
    slug: `multilingual-generator-${crypto.randomUUID()}`,
    names: [
      { lang: 'en', value: 'Portable Generator' },
      { lang: 'hi', value: 'पोर्टेबल जनरेटर' },
      { lang: 'ta', value: 'கையடக்க மின்னாக்கி' }
    ],
    aliases: ['जनरेटर बिजली', 'மின்னாக்கி மின்சாரம்'],
    searchTerms: ['बिजली', 'மின்சாரம்'],
    taskTerms: ['बिजली देना', 'மின்சாரம் வழங்கு'],
    normalizedSearchTerms: [
      'Portable Generator', 'पोर्टेबल जनरेटर', 'கையடக்க மின்னாக்கி',
      'जनरेटर बिजली', 'மின்னாக்கி மின்சாரம்', 'बिजली', 'மின்சாரம்'
    ].map((term) => term.normalize('NFKC').toLocaleLowerCase('und'))
  });
  await EquipmentAsset.create({
    assetId: `MULTILINGUAL-${crypto.randomUUID()}`,
    equipmentType: product._id,
    owner: owner._id,
    name: 'Portable Generator',
    status: 'available',
    active: true,
    dailyRate: 500,
    location: { city: 'Chennai' }
  });
  const hindi = await SearchProvider.query({ q: 'बिजली', category: 'बिजली के उपकरण', page: 1, limit: 10 });
  const tamil = await SearchProvider.query({ q: 'மின்சாரம்'.normalize('NFD'), category: 'மின் உபகரணங்கள்', page: 1, limit: 10 });
  assert.equal(hindi.pagination.total, 1);
  assert.equal(tamil.pagination.total, 1);
  assert.equal(String(hindi.items[0].equipmentType._id), String(product._id));
  assert.equal(String(tamil.items[0].equipmentType._id), String(product._id));
});

test('equipment search applies model, requirement, price, and date filters before pagination', async () => {
  const owner = await User.create({
    name: 'Search Filter Owner',
    email: `search-filter-owner-${crypto.randomUUID()}@example.com`,
    password: 'SearchFilter@123',
    role: 'owner'
  });
  const customer = await User.create({
    name: 'Search Filter Customer',
    email: `search-filter-customer-${crypto.randomUUID()}@example.com`,
    password: 'SearchFilter@123',
    role: 'customer'
  });
  const category = await Category.create({
    name: 'Search Filter Construction',
    slug: `search-filter-${crypto.randomUUID()}`
  });
  const type = await EquipmentType.create({
    category: category._id,
    name: 'Concrete Mixer',
    slug: `concrete-mixer-${crypto.randomUUID()}`,
    names: [{ lang: 'en', value: 'Concrete Mixer' }, { lang: 'ta', value: 'கான்கிரீட் கலவை' }],
    aliases: ['cement mixing'],
    normalizedSearchTerms: ['concrete mixer', 'cement mixing', 'கான்கிரீட் கலவை']
  });
  const [booked, available] = await EquipmentAsset.create([
    {
      assetId: `SEARCH-FILTER-${crypto.randomUUID()}`,
      equipmentType: type._id,
      owner: owner._id,
      name: 'Site Mixer',
      model: 'CM-900',
      dailyRate: 1200,
      condition: 'good',
      operatorRequirement: { required: true },
      transportRequirements: { required: true },
      location: { city: 'Pune' }
    },
    {
      assetId: `SEARCH-FILTER-${crypto.randomUUID()}`,
      equipmentType: type._id,
      owner: owner._id,
      name: 'Portable Mixer',
      model: 'CM-400',
      dailyRate: 700,
      condition: 'excellent',
      operatorRequirement: { required: false },
      transportRequirements: { required: false },
      location: { city: 'Pune' }
    }
  ]);
  assert.equal(booked.location.coordinates, undefined);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 4);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [],
    assets: [booked._id],
    startDate: start,
    endDate: end,
    rentalDays: 1,
    subtotal: 1200,
    depositAmount: 0,
    totalAmount: 1200,
    status: 'confirmed'
  });

  const byModel = await SearchProvider.query({ q: 'CM-900', category: category.slug, page: 1, limit: 10 });
  assert.equal(byModel.pagination.total, 1);
  assert.equal(String(byModel.items[0]._id), String(booked._id));
  const availableForDates = await SearchProvider.query({
    category: category.slug,
    startDate: start,
    endDate: end,
    minRate: 600,
    maxRate: 800,
    condition: 'excellent',
    operatorRequired: 'false',
    transportRequired: false,
    page: 1,
    limit: 1
  });
  assert.equal(availableForDates.pagination.total, 1);
  assert.equal(availableForDates.items.length, 1);
  assert.equal(String(availableForDates.items[0]._id), String(available._id));
  assert.equal(availableForDates.pagination.pages, 1);
  await assert.rejects(
    SearchProvider.query({ category: category.slug, minRate: 800, maxRate: 700 }),
    { errorCode: 'INVALID_PRICE_RANGE' }
  );
  const heldRange = new Date(start);
  heldRange.setUTCDate(heldRange.getUTCDate() + 5);
  const heldEnd = new Date(heldRange);
  heldEnd.setUTCDate(heldEnd.getUTCDate() + 1);
  await ReservationHold.create({
    customer: customer._id,
    equipment: [],
    assets: [available._id],
    startDate: heldRange,
    endDate: heldEnd,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'active'
  });
  const heldSearch = await SearchProvider.query({
    category: category.slug,
    startDate: heldRange,
    endDate: heldEnd,
    page: 1,
    limit: 10
  });
  assert.equal(heldSearch.pagination.total, 1);
  assert.equal(String(heldSearch.items[0]._id), String(booked._id));
});

test('role access is enforced for every supported user and resource owner', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'role-access-test-secret-at-least-32-characters';
  const roles = ['customer', 'owner', 'transporter', 'admin'];
  const accounts = await Promise.all(roles.map((role) => User.create({
    name: `${role} RBAC`,
    email: `rbac-${role}-${crypto.randomUUID()}@example.com`,
    password: 'RoleAccess@123',
    role,
    ...(role === 'owner' ? { phone: '+91 98765 43210' } : {}),
    ownerVerified: role === 'owner',
    verificationStatus: role === 'owner' ? 'verified' : 'pending'
  })));
  const otherOwner = await User.create({
    name: 'Other Owner RBAC',
    email: `rbac-other-owner-${crypto.randomUUID()}@example.com`,
    password: 'RoleAccess@123',
    role: 'owner',
    phone: '+91 98765 43211',
    ownerVerified: false,
    verificationStatus: 'pending'
  });
  const accountByRole = new Map(accounts.map((account) => [account.role, account]));
  const category = await Category.create({
    name: `RBAC ${crypto.randomUUID()}`,
    slug: `rbac-${crypto.randomUUID()}`,
    description: 'RBAC integration test'
  });
  const equipment = await Promise.all(['Owner One Item', 'Owner Two Item'].map((name, index) => Equipment.create({
    owner: accountByRole.get('owner')._id,
    ...(index === 1 ? { owner: otherOwner._id } : {}),
    category: category._id,
    name,
    description: 'RBAC ownership test equipment',
    dailyRate: 100,
    replacementValue: 1000,
    depositAmount: 100,
    location: { city: 'Chennai' },
    status: 'available',
    active: true
  })));
  const now = new Date();
  const booking = await Booking.create({
    customer: accountByRole.get('customer')._id,
    owner: accountByRole.get('owner')._id,
    equipment: [equipment[0]._id],
    startDate: new Date(now.getTime() + 86400000),
    endDate: new Date(now.getTime() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 100,
    depositAmount: 100,
    totalAmount: 200,
    status: 'confirmed'
  });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let createdEquipment;
  let adminCreatedEquipment;

  async function call(path, { role, method = 'GET', body, idempotencyKey = true } = {}) {
    const headers = {};
    if (role) headers.authorization = `Bearer ${tokens.get(role)}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['Idempotency-Key'] = crypto.randomUUID();
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { response, body: await response.json() };
  }

  const tokens = new Map();
  try {
    for (const role of roles) {
      const account = accountByRole.get(role);
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: 'RoleAccess@123' })
      });
      const loginBody = await login.json();
      assert.equal(login.status, 200, `${role} should be able to log in`);
      assert.equal(loginBody.data.user.role, role);
      tokens.set(role, loginBody.data.token);
      assert.equal((await call('/api/auth/me', { role })).response.status, 200, `${role} can access its own identity`);
    }
    const otherOwnerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: otherOwner.email, password: 'RoleAccess@123' })
    });
    assert.equal(otherOwnerLogin.status, 200);
    tokens.set('otherOwner', (await otherOwnerLogin.json()).data.token);

    assert.equal((await call('/api/bookings/my')).body.errorCode, 'AUTH_REQUIRED');
    assert.equal((await call('/api/bookings/my', { role: 'customer' })).response.status, 200);
    assert.equal((await call('/api/owner/equipment', { role: 'owner' })).response.status, 200);
    assert.equal((await call('/api/admin/categories', { role: 'admin' })).response.status, 200);
    assert.equal((await call(`/api/bookings/${booking.id}`, { role: 'customer' })).response.status, 200);
    assert.equal((await call(`/api/bookings/${booking.id}`, { role: 'owner' })).response.status, 200);
    assert.equal((await call(`/api/bookings/${booking.id}`, { role: 'admin' })).response.status, 200);

    const customerProfile = await call('/api/users/me', { role: 'customer' });
    assert.equal(customerProfile.response.status, 200);
    assert.equal(customerProfile.body.data.profile.role, 'customer');
    assert.equal(customerProfile.body.data.profile.email, accountByRole.get('customer').email);
    assert.equal(customerProfile.body.data.profile.preferredLanguage, 'en');
    assert.equal(customerProfile.body.data.profile.address.country, 'India');
    assert.equal('password' in customerProfile.body.data.profile, false);
    assert.equal('tokenVersion' in customerProfile.body.data.profile, false);
    assert.equal((await call(`/api/users/${accountByRole.get('owner').id}`, { role: 'customer' })).response.status, 404);

    const customerUpdate = await call('/api/users/me', {
      role: 'customer',
      method: 'PATCH',
      body: {
        name: 'Updated Customer Profile',
        email: `updated-${crypto.randomUUID()}@example.com`,
        phone: '+91 98765 43212',
        address: { line1: '12 Market Road', city: 'Chennai', postalCode: '600001' },
        preferredLanguage: 'hi',
        role: 'admin',
        password: 'NotSaved@123'
      }
    });
    assert.equal(customerUpdate.response.status, 200);
    assert.equal(customerUpdate.body.data.profile.name, 'Updated Customer Profile');
    assert.equal(customerUpdate.body.data.profile.address.line1, '12 Market Road');
    assert.equal(customerUpdate.body.data.profile.preferredLanguage, 'hi');
    assert.equal(customerUpdate.body.data.profile.role, 'customer');
    assert.equal('password' in customerUpdate.body.data.profile, false);
    const customerReadBack = await call('/api/users/me', { role: 'customer' });
    assert.equal(customerReadBack.body.data.profile.address.city, 'Chennai');
    assert.equal((await User.findById(accountByRole.get('customer')._id)).role, 'customer');

    const duplicateProfileEmail = await call('/api/users/me', {
      role: 'customer', method: 'PATCH', body: { email: accountByRole.get('owner').email }
    });
    assert.equal(duplicateProfileEmail.response.status, 409);
    assert.equal(duplicateProfileEmail.body.errorCode, 'EMAIL_IN_USE');
    const duplicateProfilePhone = await call('/api/users/me', {
      role: 'customer', method: 'PATCH', body: { phone: '9876543210' }
    });
    assert.equal(duplicateProfilePhone.response.status, 409);
    assert.equal(duplicateProfilePhone.body.errorCode, 'PHONE_IN_USE');
    const invalidProfileLanguage = await call('/api/users/me', {
      role: 'customer', method: 'PATCH', body: { preferredLanguage: 'fr' }
    });
    assert.equal(invalidProfileLanguage.response.status, 400);

    const ownerProfile = await call('/api/users/me', { role: 'owner' });
    assert.equal(ownerProfile.response.status, 200);
    assert.equal(ownerProfile.body.data.profile.verificationStatus, 'verified');
    assert.equal(ownerProfile.body.data.profile.ownerVerified, true);
    const pendingOwnerProfile = await call('/api/users/me', { role: 'otherOwner' });
    assert.equal(pendingOwnerProfile.body.data.profile.verificationStatus, 'pending');
    assert.equal(pendingOwnerProfile.body.data.profile.ownerVerified, false);
    const ownerUpdate = await call('/api/users/me', {
      role: 'owner',
      method: 'PATCH',
      body: {
        businessName: 'RentalHub Tools',
        businessType: 'Equipment rental',
        businessDescription: 'Local equipment hire',
        address: { line1: '8 Owner Street', city: 'Coimbatore' },
        preferredLanguage: 'ta'
      }
    });
    assert.equal(ownerUpdate.response.status, 200);
    assert.equal(ownerUpdate.body.data.profile.businessName, 'RentalHub Tools');
    assert.equal(ownerUpdate.body.data.profile.businessType, 'Equipment rental');
    assert.equal(ownerUpdate.body.data.profile.address.city, 'Coimbatore');
    assert.equal(ownerUpdate.body.data.profile.verificationStatus, 'verified');
    assert.equal(ownerUpdate.body.data.profile.shopName, 'RentalHub Tools');
    const customerBusinessUpdate = await call('/api/users/me', {
      role: 'customer', method: 'PATCH', body: { businessName: 'Not an owner' }
    });
    assert.equal(customerBusinessUpdate.response.status, 403);
    assert.equal(customerBusinessUpdate.body.errorCode, 'FORBIDDEN');

    const transporterProfileUpdate = await call('/api/users/me', {
      role: 'transporter',
      method: 'PATCH',
      body: {
        vehicleInfo: { vehicleType: 'Mini truck', makeModel: 'Tata Ace' },
        serviceArea: { cities: ['Chennai'], pincodes: ['600001'] },
        profileImageUrl: `/api/uploads/${crypto.randomUUID()}.png`
      }
    });
    assert.equal(transporterProfileUpdate.response.status, 200);
    assert.equal(transporterProfileUpdate.body.data.profile.vehicleInfo.vehicleType, 'Mini truck');
    assert.deepEqual(transporterProfileUpdate.body.data.profile.serviceArea.cities, ['Chennai']);
    assert.match(transporterProfileUpdate.body.data.profile.profileImageUrl, /^\/api\/uploads\//);

    const customerServiceAreaUpdate = await call('/api/users/me', {
      role: 'customer', method: 'PATCH', body: { serviceArea: { cities: ['Chennai'] } }
    });
    assert.equal(customerServiceAreaUpdate.response.status, 403);

    const created = await call('/api/owner/equipment', {
      role: 'owner',
      method: 'POST',
      body: {
        name: 'Profiled Compressor',
        description: 'Portable compressor for workshop use',
        category: String(category._id),
        brand: 'RentalHub',
        model: 'RC-2',
        manufacturingYear: 2022,
        specifications: [{ key: 'Air flow', value: '180', unit: 'L/min' }],
        dimensions: { length: 80, width: 45, height: 60, unit: 'cm' },
        weight: { value: 42, unit: 'kg' },
        operatingRequirements: { notes: 'Use on a level surface' },
        operatorRequirement: { required: false, notes: '' },
        transportRequirements: { required: true, method: 'Van', notes: 'Secure upright' },
        dailyRate: 500,
        replacementValue: 12000,
        depositAmount: 1000,
        location: { city: 'Chennai', region: 'Tamil Nadu' },
        images: ['https://example.com/compressor.jpg', `/api/uploads/${crypto.randomUUID()}.png`]
      }
    });
    assert.equal(created.response.status, 201);
    createdEquipment = created.body.data;
    assert.equal(createdEquipment.model, 'RC-2');
    assert.equal(createdEquipment.manufacturingYear, 2022);
    assert.equal(createdEquipment.specifications[0].key, 'Air flow');
    assert.equal(createdEquipment.dimensions.length, 80);
    assert.equal(createdEquipment.weight.value, 42);
    assert.equal(createdEquipment.operatorRequirement.required, false);
    assert.equal(createdEquipment.transportRequirements.method, 'Van');
    assert.equal(createdEquipment.images.length, 2);
    assert.equal(createdEquipment.verificationStatus, 'pending');
    const createdAsset = await EquipmentAsset.findOne({ legacyEquipment: createdEquipment._id });
    assert.ok(createdAsset);
    assert.equal(createdAsset.model, 'RC-2');
    assert.equal(createdAsset.transportRequirements.method, 'Van');

    const retrievedEquipment = await call(`/api/owner/equipment/${createdEquipment._id}`, { role: 'owner' });
    assert.equal(retrievedEquipment.response.status, 200);
    assert.equal(retrievedEquipment.body.data.specifications[0].value, '180');
    const passport = await call(`/api/owner/equipment/${createdEquipment._id}/passport`, { role: 'owner' });
    assert.equal(passport.response.status, 200);
    assert.equal(String(passport.body.data.equipment.id), String(createdEquipment._id));
    assert.ok(Array.isArray(passport.body.data.rentalHistory));
    assert.ok(Array.isArray(passport.body.data.maintenanceHistory));
    assert.equal(Object.hasOwn(passport.body.data, 'customers'), false);
    const ownerAnalytics = await call('/api/owner/analytics', { role: 'owner' });
    assert.equal(ownerAnalytics.response.status, 200);
    assert.equal(ownerAnalytics.body.data.reviews.message, 'Not enough rental history.');
    assert.ok(ownerAnalytics.body.data.pricingRecommendations.some((item) =>
      String(item.equipmentId) === String(createdEquipment._id) && item.message === 'Not enough data for pricing recommendation.'
    ));
    const customerPassport = await call(`/api/owner/equipment/${createdEquipment._id}/passport`, { role: 'customer' });
    assert.equal(customerPassport.response.status, 403);
    const publicEquipment = await call(`/api/equipment/${createdEquipment._id}`);
    assert.equal(publicEquipment.response.status, 200);
    assert.equal(publicEquipment.body.data.owner._id, String(accountByRole.get('owner')._id));
    assert.equal('assetRef' in publicEquipment.body.data, false);
    assert.equal('serialNumber' in publicEquipment.body.data, false);
    assert.equal('reservationLock' in publicEquipment.body.data, false);
    const publicList = await call('/api/equipment');
    assert.ok(publicList.body.data.items.some((item) => String(item._id) === String(createdEquipment._id)));

    const editedEquipment = await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'owner',
      method: 'PATCH',
      body: {
        model: 'RC-3',
        specifications: [{ key: 'Air flow', value: '200', unit: 'L/min' }],
        dimensions: { width: 50, unit: 'cm' },
        dailyRate: 600
      }
    });
    assert.equal(editedEquipment.response.status, 200);
    assert.equal(editedEquipment.body.data.model, 'RC-3');
    assert.equal(editedEquipment.body.data.dailyRate, 600);
    const editedRetrieved = await call(`/api/owner/equipment/${createdEquipment._id}`, { role: 'owner' });
    assert.equal(editedRetrieved.body.data.model, 'RC-3');
    const editedAsset = await EquipmentAsset.findOne({ legacyEquipment: createdEquipment._id });
    assert.equal(editedAsset.model, 'RC-3');
    assert.equal(editedAsset.dimensions.width, 50);
    const publicUnavailable = await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'otherOwner', method: 'PATCH', body: { model: 'Cross-owner edit' }
    });
    assert.equal(publicUnavailable.response.status, 404);
    const otherOwnerDelete = await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'otherOwner', method: 'DELETE'
    });
    assert.equal(otherOwnerDelete.response.status, 404);
    assert.equal((await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'customer', method: 'DELETE'
    })).response.status, 403);
    const ownerVerificationEdit = await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'owner', method: 'PATCH', body: { verificationStatus: 'verified' }
    });
    assert.equal(ownerVerificationEdit.response.status, 403);

    for (const invalid of [
      { manufacturingYear: 1800 },
      { dimensions: { length: -1 } },
      { weight: { value: -5 } },
      { images: ['not-a-url'] },
      { specifications: [{ key: '', value: 'missing key' }] }
    ]) {
      const invalidCreate = await call('/api/owner/equipment', {
        role: 'owner',
        method: 'POST',
        body: {
          name: 'Invalid equipment',
          description: 'Should not be saved',
          category: String(category._id),
          dailyRate: 100,
          location: 'Chennai',
          ...invalid
        }
      });
      assert.equal(invalidCreate.response.status, 400);
    }

    const adminList = await call('/api/admin/equipment', { role: 'admin' });
    assert.equal(adminList.response.status, 200);
    assert.ok(adminList.body.data.some((item) => String(item._id) === String(createdEquipment._id)));
    assert.equal((await call('/api/admin/equipment', { role: 'owner' })).response.status, 403);
    const adminVerified = await call(`/api/admin/equipment/${createdEquipment._id}`, {
      role: 'admin', method: 'PATCH', body: { verificationStatus: 'verified' }
    });
    assert.equal(adminVerified.response.status, 200);
    assert.equal(adminVerified.body.data.verificationStatus, 'verified');

    const deactivated = await call(`/api/owner/equipment/${createdEquipment._id}`, {
      role: 'owner', method: 'DELETE'
    });
    assert.equal(deactivated.response.status, 200);
    assert.equal(deactivated.body.data.active, false);
    assert.equal((await EquipmentAsset.findOne({ legacyEquipment: createdEquipment._id })).active, false);
    assert.equal((await call(`/api/equipment/${createdEquipment._id}`)).response.status, 404);
    assert.equal((await call(`/api/owner/equipment/${createdEquipment._id}`, { role: 'owner' })).response.status, 200);

    const adminCreated = await call('/api/admin/equipment', {
      role: 'admin',
      method: 'POST',
      body: {
        ownerId: String(accountByRole.get('owner')._id),
        name: 'Admin-managed generator',
        description: 'Generator listed by an administrator',
        category: String(category._id),
        dailyRate: 800,
        location: 'Chennai',
        verificationStatus: 'verified'
      }
    });
    assert.equal(adminCreated.response.status, 201);
    adminCreatedEquipment = adminCreated.body.data;
    assert.equal(adminCreatedEquipment.owner, String(accountByRole.get('owner')._id));
    assert.equal(adminCreatedEquipment.verificationStatus, 'verified');
    const adminDeactivated = await call(`/api/admin/equipment/${adminCreatedEquipment._id}`, {
      role: 'admin', method: 'DELETE'
    });
    assert.equal(adminDeactivated.response.status, 200);
    assert.equal(adminDeactivated.body.data.active, false);

    for (const role of ['customer', 'transporter']) {
      const forbidden = await call('/api/owner/equipment', { role, method: 'POST', body: {} });
      assert.equal(forbidden.response.status, 403, `${role} cannot create owner equipment`);
      assert.equal(forbidden.body.errorCode, 'FORBIDDEN');
    }
    for (const role of ['owner', 'transporter', 'admin']) {
      const forbidden = await call('/api/bookings/my', { role });
      assert.equal(forbidden.response.status, 403, `${role} cannot access customer booking list`);
    }
    for (const role of ['customer', 'owner', 'transporter']) {
      const forbidden = await call('/api/admin/categories', { role });
      assert.equal(forbidden.response.status, 403, `${role} cannot access admin routes`);
    }
    for (const role of ['transporter', 'admin']) {
      const forbidden = await call('/api/bookings/holds', { role, method: 'POST', body: {} });
      assert.equal(forbidden.response.status, 403, `${role} cannot create customer reservation holds`);
    }
    const forbiddenWithoutIdempotencyKey = await call('/api/bookings/holds', {
      role: 'transporter', method: 'POST', body: {}, idempotencyKey: false
    });
    assert.equal(forbiddenWithoutIdempotencyKey.response.status, 403,
      'role authorization runs before idempotency-key validation');

    const otherOwnersBooking = await call(`/api/bookings/${booking.id}`, { role: 'transporter' });
    assert.equal(otherOwnersBooking.response.status, 403);
    const ownerCannotReadOtherEquipment = await call(`/api/owner/equipment/${equipment[0]._id}`, { role: 'transporter' });
    assert.equal(ownerCannotReadOtherEquipment.response.status, 403);

    const ownerEquipment = await call(`/api/owner/equipment/${equipment[0]._id}`, { role: 'owner' });
    assert.equal(ownerEquipment.response.status, 200);
    const crossOwnerPatch = await call(`/api/owner/equipment/${equipment[1]._id}`, {
      role: 'owner', method: 'PATCH', body: { name: 'Unauthorized Change' }
    });
    assert.equal(crossOwnerPatch.response.status, 404);
    const customerPatch = await call(`/api/owner/equipment/${equipment[0]._id}`, {
      role: 'customer', method: 'PATCH', body: { name: 'Customer Change' }
    });
    assert.equal(customerPatch.response.status, 403);
    const adminEquipmentPatch = await call(`/api/owner/equipment/${equipment[0]._id}`, {
      role: 'admin', method: 'PATCH', body: { name: 'Admin Change' }
    });
    assert.equal(adminEquipmentPatch.response.status, 200);
    assert.equal((await Equipment.findById(equipment[0]._id)).name, 'Admin Change');

    for (const role of ['customer', 'otherOwner', 'transporter', 'admin']) {
      const forbiddenStatusChange = await call(`/api/bookings/${booking.id}/status`, {
        role, method: 'PATCH', body: { status: 'in_progress' }
      });
      assert.equal(forbiddenStatusChange.response.status, 403, `${role} cannot change a booking they do not own`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await Booking.deleteOne({ _id: booking._id });
    const equipmentIds = [
      ...equipment.map((item) => item._id),
      createdEquipment?._id,
      adminCreatedEquipment?._id
    ].filter(Boolean);
    await EquipmentAsset.deleteMany({ legacyEquipment: { $in: equipmentIds } });
    await Equipment.deleteMany({ _id: { $in: equipmentIds } });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: accounts.map((account) => account._id) } });
    await User.deleteOne({ _id: otherOwner._id });
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('authentication routes issue tokens and return the standard error envelope', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.JWT_SECRET = 'foundation-test-secret-that-is-at-least-32-characters';
  process.env.NODE_ENV = 'development';
  const email = `foundation-${crypto.randomUUID()}@example.com`;
  const transporterEmail = `transporter-${crypto.randomUUID()}@example.com`;
  const phone = `+91 98765 ${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) => fetch(`${baseUrl}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  try {
    const weakPassword = await request('register', { name: 'Weak Password', email, password: 'short' });
    assert.equal(weakPassword.status, 400);
    assert.equal((await weakPassword.json()).errorCode, 'VALIDATION_ERROR');

    const adminRegistration = await request('register', {
      name: 'Admin Attempt', email, password: 'Foundation@123', role: 'admin'
    });
    assert.equal(adminRegistration.status, 400);

    const transporterRegistration = await request('register', {
      name: 'Transporter Test',
      email: transporterEmail,
      password: 'Foundation@123',
      role: 'TRANSPORTER'
    });
    assert.equal(transporterRegistration.status, 201);
    assert.equal((await transporterRegistration.json()).data.user.role, 'transporter');

    const unverifiedPhoneRegistration = await request('register', {
      name: 'Unverified Phone',
      email: `unverified-${crypto.randomUUID()}@example.com`,
      phone: '9876543212',
      password: 'Foundation@123'
    });
    assert.equal(unverifiedPhoneRegistration.status, 400);
    assert.equal((await unverifiedPhoneRegistration.json()).errorCode, 'PHONE_NOT_VERIFIED');

    const otpRequest = await request('phone/otp/request', { phone, purpose: 'registration' });
    const otpRequestBody = await otpRequest.json();
    assert.equal(otpRequest.status, 202);
    assert.match(otpRequestBody.data.developmentCode, /^\d{6}$/);
    assert.equal(otpRequestBody.data.developmentOnly, true);
    assert.equal(Object.hasOwn(otpRequestBody.data, 'codeHash'), false);
    const registrationChallenge = await PhoneOtpChallenge.findById(otpRequestBody.data.challengeId).select('+codeHash +codeSalt');
    assert.ok(registrationChallenge);
    assert.notEqual(registrationChallenge.codeHash, otpRequestBody.data.developmentCode);
    const otpVerification = await request('phone/otp/verify', {
      phone,
      challengeId: otpRequestBody.data.challengeId,
      code: otpRequestBody.data.developmentCode
    });
    assert.equal(otpVerification.status, 200);

    const registration = await request('register', {
      name: 'Foundation Test', email: email.toUpperCase(), phone,
      phoneOtpChallengeId: registrationChallenge.id,
      password: 'Foundation@123', role: 'transporter', preferredLanguage: 'ta'
    });
    const registered = await registration.json();
    assert.equal(registration.status, 201);
    assert.equal(registered.success, true);
    assert.equal(registered.data.user.role, 'transporter');
    assert.equal(registered.data.user.preferredLanguage, 'ta');
    assert.ok(registered.data.token);
    assert.equal(Object.hasOwn(registered.data.user, 'password'), false);
    const storedUser = await User.findOne({ email }).select('+password');
    assert.ok(storedUser);
    assert.equal(storedUser.phone, phone);
    assert.equal(storedUser.preferredLanguage, 'ta');
    assert.notEqual(storedUser.password, 'Foundation@123');
    assert.equal(await storedUser.comparePassword('Foundation@123'), true);

    const current = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${registered.data.token}` }
    });
    const currentBody = await current.json();
    assert.equal(current.status, 200);
    assert.equal(currentBody.data.user.email, email);

    await User.collection.updateOne({ email: transporterEmail }, { $set: { role: 'inspector' } });
    const legacyTransporterLogin = await request('login', {
      email: transporterEmail,
      password: 'Foundation@123'
    });
    const migratedTransporter = await legacyTransporterLogin.json();
    assert.equal(legacyTransporterLogin.status, 200);
    assert.equal(migratedTransporter.data.user.role, 'transporter');
    assert.equal((await User.findOne({ email: transporterEmail })).role, 'transporter');
    const legacySession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${migratedTransporter.data.token}` }
    });
    assert.equal(legacySession.status, 200);
    assert.equal((await legacySession.json()).data.user.role, 'transporter');

    const badLogin = await request('login', { email, password: 'WrongPassword@123' });
    assert.equal(badLogin.status, 401);
    assert.equal((await badLogin.json()).errorCode, 'INVALID_CREDENTIALS');

    const goodLogin = await request('login', { email: email.toUpperCase(), password: 'Foundation@123' });
    const signedIn = await goodLogin.json();
    assert.equal(goodLogin.status, 200);
    assert.ok(signedIn.data.token);
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signedIn.data.token}` }
    });
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).success, true);
    const revoked = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${signedIn.data.token}` }
    });
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).errorCode, 'SESSION_REVOKED');
    const registrationTokenRevoked = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${registered.data.token}` }
    });
    assert.equal(registrationTokenRevoked.status, 401);
    assert.equal((await registrationTokenRevoked.json()).errorCode, 'SESSION_REVOKED');

    const reauthenticated = await request('login', { email, password: 'Foundation@123' });
    const newSession = await reauthenticated.json();
    assert.equal(reauthenticated.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${newSession.data.token}` }
    })).status, 200);

    const passwordChange = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${newSession.data.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        currentPassword: 'Foundation@123',
        newPassword: 'Foundation@456'
      })
    });
    assert.equal(passwordChange.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${newSession.data.token}` }
    })).status, 401);
    assert.equal((await request('login', { email, password: 'Foundation@123' })).status, 401);
    assert.equal((await request('login', { email, password: 'Foundation@456' })).status, 200);

    const duplicateEmail = await request('register', {
      name: 'Duplicate Email', email: email.toUpperCase(), password: 'Foundation@123'
    });
    assert.equal(duplicateEmail.status, 409);
    assert.equal((await duplicateEmail.json()).errorCode, 'EMAIL_IN_USE');

    const duplicatePhone = await request('register', {
      name: 'Duplicate Phone',
      email: `duplicate-${crypto.randomUUID()}@example.com`,
      phone: phone.replace('+91 ', '0').replace(' ', ''),
      password: 'Foundation@123'
    });
    assert.equal(duplicatePhone.status, 409);
    assert.equal((await duplicatePhone.json()).errorCode, 'PHONE_IN_USE');

    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });
    const malformedBody = await malformed.json();
    assert.equal(malformed.status, 400);
    assert.deepEqual(
      { success: malformedBody.success, errorCode: malformedBody.errorCode },
      { success: false, errorCode: 'INVALID_JSON' }
    );

    const missingRoute = await fetch(`${baseUrl}/api/not-a-route`);
    const missingRouteBody = await missingRoute.json();
    assert.equal(missingRoute.status, 404);
    assert.deepEqual(
      { success: missingRouteBody.success, errorCode: missingRouteBody.errorCode },
      { success: false, errorCode: 'ROUTE_NOT_FOUND' }
    );
  } finally {
    await User.deleteMany({ $or: [{ email }, { email: transporterEmail }, { phone }] });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});

test('password recovery sends a one-time link and revokes existing sessions', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldProviderUrl = process.env.PASSWORD_RESET_PROVIDER_URL;
  const oldProviderToken = process.env.PASSWORD_RESET_PROVIDER_TOKEN;
  const oldResetUrl = process.env.PASSWORD_RESET_URL;
  const originalFetch = global.fetch;
  process.env.JWT_SECRET = 'password-reset-test-secret-at-least-32-characters';
  process.env.PASSWORD_RESET_PROVIDER_URL = 'https://mail-provider.example.test';
  process.env.PASSWORD_RESET_PROVIDER_TOKEN = 'test-provider-token';
  process.env.PASSWORD_RESET_URL = 'http://localhost:5173/reset-password';
  const email = `password-reset-${crypto.randomUUID()}@example.com`;
  const user = await User.create({ name: 'Reset Customer', email, password: 'ResetCustomer@123' });
  const activeToken = jwt.sign({ sub: user.id, role: user.role, ver: user.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let deliveredMessage;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    assert.equal(url, 'https://mail-provider.example.test/messages');
    assert.equal(options.headers.authorization, 'Bearer test-provider-token');
    deliveredMessage = JSON.parse(options.body);
    return { ok: true };
  };
  try {
    const forgotResponse = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.equal(forgotResponse.status, 200);
    assert.match((await forgotResponse.json()).message, /If an account exists/);
    assert.equal(deliveredMessage.to, email);
    const rawToken = new URL(deliveredMessage.resetUrl).searchParams.get('token');
    assert.match(rawToken, /^[a-f0-9]{64}$/);
    const storedToken = await PasswordResetToken.findOne({ user: user._id }).select('+tokenHash');
    assert.ok(storedToken);
    assert.notEqual(storedToken.tokenHash, rawToken);

    const resetResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken, newPassword: 'ResetCustomer@456' })
    });
    assert.equal(resetResponse.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${activeToken}` }
    })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawToken, newPassword: 'ResetCustomer@789' })
    })).status, 400);

    const oldPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'ResetCustomer@123' })
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'ResetCustomer@456' })
    });
    assert.equal(newPasswordLogin.status, 200);
  } finally {
    global.fetch = originalFetch;
    await PasswordResetToken.deleteMany({ user: user._id });
    await User.deleteOne({ _id: user._id });
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldProviderUrl === undefined) delete process.env.PASSWORD_RESET_PROVIDER_URL;
    else process.env.PASSWORD_RESET_PROVIDER_URL = oldProviderUrl;
    if (oldProviderToken === undefined) delete process.env.PASSWORD_RESET_PROVIDER_TOKEN;
    else process.env.PASSWORD_RESET_PROVIDER_TOKEN = oldProviderToken;
    if (oldResetUrl === undefined) delete process.env.PASSWORD_RESET_URL;
    else process.env.PASSWORD_RESET_URL = oldResetUrl;
  }
});

test('development OTP is shown in the app response, hashed at rest, and disabled in production', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.JWT_SECRET = 'otp-test-secret-that-is-at-least-32-characters';
  process.env.NODE_ENV = 'development';
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/auth/phone/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', purpose: 'registration' })
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.match(body.data.developmentCode, /^\d{6}$/);
    assert.equal(body.data.developmentOnly, true);
    assert.equal(Object.hasOwn(body.data, 'codeHash'), false);
    const challenge = await PhoneOtpChallenge.findById(body.data.challengeId).select('+codeHash +codeSalt');
    assert.ok(challenge);
    assert.notEqual(challenge.codeHash, body.data.developmentCode);

    const verified = await fetch(`${baseUrl}/api/auth/phone/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', challengeId: challenge.id, code: body.data.developmentCode })
    });
    assert.equal(verified.status, 200);
    assert.ok((await PhoneOtpChallenge.findById(challenge.id)).verifiedAt);

    process.env.NODE_ENV = 'production';
    const productionRequest = await fetch(`${baseUrl}/api/auth/phone/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', purpose: 'registration' })
    });
    assert.equal(productionRequest.status, 503);
    assert.equal((await productionRequest.json()).errorCode, 'OTP_NOT_CONFIGURED');
  } finally {
    server.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});

test('authenticated image uploads persist and serve validated image bytes', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldProvider = process.env.UPLOAD_PROVIDER;
  const oldUploadDir = process.env.UPLOAD_DIR;
  process.env.JWT_SECRET = 'upload-test-secret-that-is-at-least-32-characters';
  process.env.UPLOAD_PROVIDER = 'local';
  process.env.UPLOAD_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'rentalhub-upload-test-'));
  const user = await User.create({
    name: 'Upload Customer',
    email: `upload-${crypto.randomUUID()}@example.com`,
    password: 'UploadCustomer@123'
  });
  const token = jwt.sign({ sub: user.id, role: user.role, ver: user.tokenVersion }, process.env.JWT_SECRET);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7ZkAAAAASUVORK5CYII=', 'base64');
  try {
    const form = new FormData();
    form.append('image', new Blob([imageBytes], { type: 'image/png' }), 'equipment.png');
    const uploadResponse = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    const uploadBody = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201);
    assert.equal(uploadBody.data.mimeType, 'image/png');
    assert.equal(uploadBody.data.size, imageBytes.length);

    const imageResponse = await fetch(`${baseUrl}${uploadBody.data.url}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageBytes);

    const unauthorized = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: new FormData() });
    assert.equal(unauthorized.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await User.deleteOne({ _id: user._id });
    await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldProvider === undefined) delete process.env.UPLOAD_PROVIDER;
    else process.env.UPLOAD_PROVIDER = oldProvider;
    if (oldUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldUploadDir;
  }
});

test('Socket.IO accepts active JWT users and rejects invalid tokens', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'socket-foundation-test-secret-at-least-32-characters';
  const user = await User.create({
    name: 'Socket Test User',
    email: `socket-${crypto.randomUUID()}@example.com`,
    password: 'Socket@123',
    role: 'customer'
  });
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
  const server = createServer(app);
  const io = attachSocketServer(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const socketUrl = `http://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=polling`;

  async function connectWith(authToken) {
    const openResponse = await fetch(socketUrl);
    assert.equal(openResponse.status, 200);
    const openPacket = await openResponse.text();
    assert.ok(openPacket.startsWith('0'));
    const sid = JSON.parse(openPacket.slice(1)).sid;
    await fetch(`${socketUrl}&sid=${sid}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: `40${JSON.stringify({ token: authToken })}`
    });
    const result = await fetch(`${socketUrl}&sid=${sid}`);
    return result.text();
  }

  try {
    assert.match(await connectWith(token), /^40\{"sid":/);
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    assert.match(await connectWith(token), /^44\{"message":"Session has expired"\}/);
    assert.match(await connectWith('invalid-token'), /^44\{"message":"Invalid or expired access token"\}/);
  } finally {
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await User.deleteOne({ _id: user._id });
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test('ledger postings are durable, append-only, and idempotent', async () => {
  const entry = {
    idempotencyKey: 'test-booking-payment-rental',
    debitAccount: 'payment_clearing',
    creditAccount: 'rental_payable',
    amount: 123.45,
    currency: 'INR',
    sourceType: 'booking_payment',
    sourceId: 'booking-test'
  };
  const first = await postLedgerEntry(entry);
  const replay = await postLedgerEntry(entry);

  assert.equal(first._id.toString(), replay._id.toString());
  assert.equal(first.amountMinor, 12345);
  await assert.rejects(
    () => postLedgerEntry({ ...entry, amount: 124 }),
    { code: 'LEDGER_IDEMPOTENCY_CONFLICT' }
  );
  await assert.rejects(
    () => LedgerEntry.updateOne({ _id: first._id }, { $set: { amountMinor: 1 } }),
    /append-only/
  );
});

test('idempotency middleware replays persisted responses and rejects key reuse', async () => {
  const makeRequest = (body, key = 'test-idempotency-key-01') => ({
    get: () => key,
    user: { id: 'idempotency-test-user' },
    method: 'POST',
    originalUrl: '/api/test-action',
    baseUrl: '/api',
    path: '/test-action',
    body
  });
  const makeResponse = () => ({
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  const firstResponse = makeResponse();
  let firstNext = false;
  await idempotency(makeRequest({ amount: 10 }), firstResponse, () => { firstNext = true; });
  assert.equal(firstNext, true);
  await firstResponse.status(201).json({ success: true, data: { paymentId: 'payment-1' } });

  const replayResponse = makeResponse();
  let replayNext = false;
  await idempotency(makeRequest({ amount: 10 }), replayResponse, () => { replayNext = true; });
  assert.equal(replayNext, false);
  assert.equal(replayResponse.statusCode, 201);
  assert.deepEqual(replayResponse.body, { success: true, data: { paymentId: 'payment-1' } });

  let conflict;
  await idempotency(makeRequest({ amount: 11 }), makeResponse(), (error) => { conflict = error; });
  assert.equal(conflict.errorCode, 'IDEMPOTENCY_CONFLICT');
});

test('MongoDB rate-limit counters are shared and increment atomically', async () => {
  const previousStore = process.env.RATE_LIMIT_STORE;
  process.env.RATE_LIMIT_STORE = 'mongodb';
  const address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const req = { path: '/api/test-rate-limit', ip: address, socket: { remoteAddress: address } };
  const windowStart = Math.floor(Date.now() / 60000) * 60000;
  const bucketKey = crypto.createHash('sha256').update(`${address}:${windowStart}`).digest('hex');
  try {
    await Promise.all(Array.from({ length: 10 }, () =>
      rateLimit(req, {}, (error) => { if (error) throw error; })));
    const bucket = await RateLimitBucket.findOne({ bucketKey });
    assert.equal(bucket.count, 10);
  } finally {
    if (previousStore === undefined) delete process.env.RATE_LIMIT_STORE;
    else process.env.RATE_LIMIT_STORE = previousStore;
  }
});

test('Razorpay signatures are verified against exact checkout and webhook payloads', () => {
  const oldKeyId = process.env.RAZORPAY_KEY_ID;
  const oldSecret = process.env.RAZORPAY_KEY_SECRET;
  const oldWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test-payment-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  try {
    const checkoutSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update('order_test123|pay_test456')
      .digest('hex');
    const rawWebhook = Buffer.from('{"event":"payment.captured"}');
    const webhookSignature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawWebhook)
      .digest('hex');
    assert.equal(verifyCheckoutSignature('order_test123', 'pay_test456', checkoutSignature), true);
    assert.equal(verifyCheckoutSignature('order_test123', 'pay_other', checkoutSignature), false);
    assert.equal(verifyWebhookSignature(rawWebhook, webhookSignature), true);
    assert.equal(verifyWebhookSignature(Buffer.from('{}'), webhookSignature), false);
  } finally {
    if (oldKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = oldKeyId;
    if (oldSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = oldSecret;
    if (oldWebhookSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = oldWebhookSecret;
  }
});

test('Razorpay order creation uses minor units and recovers by receipt', async () => {
  const oldKeyId = process.env.RAZORPAY_KEY_ID;
  const oldSecret = process.env.RAZORPAY_KEY_SECRET;
  const originalFetch = global.fetch;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test-payment-secret';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: 'order_provider_test',
      amount: body.amount,
      currency: body.currency,
      receipt: body.receipt
    }), { status: 200 });
  };
  try {
    const order = await createOrRecoverOrder({
      amountMinor: 12550,
      currency: 'INR',
      receipt: 'rh_test_receipt_12345678901234567890',
      notes: { bookingId: 'booking-1' }
    });
    assert.equal(order.id, 'order_provider_test');
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].options.body).amount, 12550);
  } finally {
    global.fetch = originalFetch;
    if (oldKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = oldKeyId;
    if (oldSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = oldSecret;
  }
});

test('Razorpay payment capture confirms the booking once and posts the ledger', async () => {
  const customer = await User.create({ name: 'Payment Customer', email: 'payment-customer@example.com', password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Payment Owner', email: 'payment-owner@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Payment Test Gear', slug: 'payment-test-gear', description: 'Payment test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Payment Test Item',
    description: 'Payment test item',
    dailyRate: 1000,
    replacementValue: 5000,
    depositAmount: 200,
    location: { city: 'Mumbai' }
  });

  test('signed Razorpay webhook verifies the raw body and persists replay protection', async () => {
    const oldProvider = process.env.PAYMENT_PROVIDER;
    const oldKeyId = process.env.RAZORPAY_KEY_ID;
    const oldSecret = process.env.RAZORPAY_KEY_SECRET;
    const oldWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.PAYMENT_PROVIDER = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test-payment-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
    const customer = await User.create({ name: 'Webhook Customer', email: 'webhook-customer@example.com', password: 'Customer@123', role: 'customer' });
    const owner = await User.create({ name: 'Webhook Owner', email: 'webhook-owner@example.com', password: 'Owner@123', role: 'owner' });
    const category = await Category.create({ name: 'Webhook Test Gear', slug: 'webhook-test-gear', description: 'Webhook test category' });
    const equipment = await Equipment.create({
      owner: owner._id,
      category: category._id,
      name: 'Webhook Test Item',
      description: 'Webhook test item',
      dailyRate: 1000,
      replacementValue: 5000,
      depositAmount: 200,
      location: { city: 'Pune' }
    });
    const now = new Date();
    const booking = await Booking.create({
      customer: customer._id,
      owner: owner._id,
      equipment: [equipment._id],
      startDate: new Date(now.getTime() + 86400000),
      endDate: new Date(now.getTime() + 2 * 86400000),
      rentalDays: 1,
      subtotal: 1000,
      depositAmount: 200,
      totalAmount: 1200,
      status: 'pending_payment',
      paymentExpiresAt: new Date(now.getTime() + 600000)
    });
    const payment = await Payment.create({
      booking: booking._id,
      customer: customer._id,
      amount: 1200,
      currency: 'INR',
      method: 'razorpay',
      status: 'pending',
      transactionId: 'order_webhook_test',
      providerOrderId: 'order_webhook_test',
      operationKey: `booking:${booking._id}:checkout:webhook-test`
    });
    const payload = Buffer.from(JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: {
        id: 'pay_webhook_test',
        order_id: 'order_webhook_test',
        amount: 120000,
        currency: 'INR',
        status: 'captured'
      } } }
    }));
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest('hex');
    const server = app.listen(0);
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/payments/razorpay/webhook`;
      const headers = {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': 'evt_webhook_test'
      };
      const first = await fetch(url, { method: 'POST', headers, body: payload });
      assert.equal(first.status, 200);
      const replay = await fetch(url, { method: 'POST', headers, body: payload });
      assert.equal(replay.status, 200);
      assert.equal((await Booking.findById(booking._id)).status, 'confirmed');
      assert.equal((await Payment.findById(payment._id)).status, 'succeeded');
      assert.equal(await WebhookEvent.countDocuments({ eventId: 'evt_webhook_test', status: 'processed' }), 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (oldProvider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = oldProvider;
      if (oldKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = oldKeyId;
      if (oldSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = oldSecret;
      if (oldWebhookSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = oldWebhookSecret;
    }
  });
  const now = new Date();
  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(now.getTime() + 86400000),
    endDate: new Date(now.getTime() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 1000,
    depositAmount: 200,
    totalAmount: 1200,
    status: 'pending_payment',
    paymentExpiresAt: new Date(now.getTime() + 600000)
  });
  const payment = await Payment.create({
    booking: booking._id,
    customer: customer._id,
    amount: 1200,
    currency: 'INR',
    method: 'razorpay',
    status: 'pending',
    transactionId: 'order_capture_test',
    providerOrderId: 'order_capture_test',
    operationKey: `booking:${booking._id}:checkout:test`
  });

  const first = await finalizeCapturedPayment(payment, 'pay_capture_test');
  const replay = await finalizeCapturedPayment(payment, 'pay_capture_test');
  const persistedBooking = await Booking.findById(booking._id);
  assert.equal(first.booking.status, 'confirmed');
  assert.equal(replay.booking.status, 'confirmed');
  assert.equal(persistedBooking.payment.toString(), payment._id.toString());
  assert.equal((await LedgerEntry.countDocuments({ sourceId: payment._id.toString() })), 2);
  assert.equal((await Payment.findById(payment._id)).status, 'succeeded');

  const duplicatePayment = await Payment.create({
    booking: booking._id,
    customer: customer._id,
    amount: 1200,
    currency: 'INR',
    method: 'mock',
    status: 'pending',
    transactionId: 'mock_duplicate_capture_test'
  });
  const duplicateCapture = await finalizeCapturedPayment(duplicatePayment, 'mock_duplicate_capture_test');
  const duplicateReplay = await finalizeCapturedPayment(duplicatePayment, 'mock_duplicate_capture_test');
  assert.equal(duplicateCapture.refunded, true);
  assert.equal(duplicateReplay.refunded, true);
  assert.equal((await Payment.findById(duplicatePayment._id)).status, 'refunded');
  assert.equal(String((await Booking.findById(booking._id)).payment), String(payment._id));
  assert.equal(await LedgerEntry.countDocuments({
    idempotencyKey: { $in: [
      `payment:${duplicatePayment._id}:unapplied-capture`,
      `payment:${duplicatePayment._id}:unapplied-refund`
    ] }
  }), 2);
});

test('duplicate-payment refund webhooks reverse overpayment liability exactly once', async () => {
  const customer = await User.create({ name: 'Duplicate Customer', email: 'duplicate-customer@example.com', password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Duplicate Owner', email: 'duplicate-owner@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Duplicate Test Gear', slug: 'duplicate-test-gear', description: 'Duplicate payment test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Duplicate Test Item',
    description: 'Duplicate payment test item',
    dailyRate: 1000,
    replacementValue: 5000,
    depositAmount: 200,
    location: { city: 'Mumbai' }
  });
  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 1000,
    depositAmount: 200,
    totalAmount: 1200,
    status: 'confirmed'
  });
  const payment = await Payment.create({
    booking: booking._id,
    customer: customer._id,
    amount: 1200,
    currency: 'INR',
    method: 'razorpay',
    status: 'succeeded',
    transactionId: 'order_duplicate_test',
    providerOrderId: 'order_duplicate_test',
    providerPaymentId: 'pay_duplicate_test'
  });
  const refund = await Refund.create({
    booking: booking._id,
    payment: payment._id,
    idempotencyKey: `booking:${booking._id}:unapplied-payment:${payment._id}`,
    receipt: `rh_duplicate_${payment._id}`,
    amountMinor: 120000,
    currency: 'INR',
    provider: 'razorpay',
    providerRefundId: 'rfnd_duplicate_test',
    status: 'pending',
    reason: 'duplicate_payment'
  });
  const ledgerData = {
    debitAccount: 'payment_clearing',
    creditAccount: 'customer_overpayment_liability',
    amount: 1200,
    currency: 'INR',
    sourceType: 'unapplied_booking_payment',
    sourceId: String(booking._id),
    metadata: { bookingId: String(booking._id), paymentId: String(payment._id) }
  };
  await postLedgerEntry({ ...ledgerData, idempotencyKey: `payment:${payment._id}:unapplied-capture` });
  const details = { amount: 120000, currency: 'INR', paymentId: 'pay_duplicate_test' };

  await resolveProviderRefund(refund.providerRefundId, 'processed', details);
  await resolveProviderRefund(refund.providerRefundId, 'processed', details);

  assert.equal((await Refund.findById(refund._id)).status, 'succeeded');
  assert.equal((await Payment.findById(payment._id)).status, 'refunded');
  assert.equal(await LedgerEntry.countDocuments({
    idempotencyKey: {
      $in: [
        `payment:${payment._id}:unapplied-capture`,
        `payment:${payment._id}:unapplied-refund`
      ]
    }
  }), 2);
});

test('refund records replay safely and reject over-refunding or changed details', async () => {
  const customer = await User.create({ name: 'Refund Customer', email: 'refund-customer@example.com', password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Refund Owner', email: 'refund-owner@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Refund Test Gear', slug: 'refund-test-gear', description: 'Refund test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Refund Test Item',
    description: 'Refund test item',
    dailyRate: 1000,
    replacementValue: 5000,
    depositAmount: 200,
    location: { city: 'Delhi' }
  });
  const now = new Date();
  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(now.getTime() + 86400000),
    endDate: new Date(now.getTime() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 800,
    depositAmount: 200,
    totalAmount: 1000,
    status: 'confirmed'
  });
  const payment = await Payment.create({
    booking: booking._id,
    customer: customer._id,
    amount: 1000,
    currency: 'INR',
    method: 'mock',
    status: 'succeeded',
    transactionId: 'mock_refund_test'
  });
  const first = await issueRefund({
    payment, booking, amount: 200,
    idempotencyKey: `test-refund:${booking._id}:deposit`,
    reason: 'deposit_refund'
  });
  const replay = await issueRefund({
    payment, booking, amount: 200,
    idempotencyKey: `test-refund:${booking._id}:deposit`,
    reason: 'deposit_refund'
  });
  assert.equal(first._id.toString(), replay._id.toString());
  assert.equal(first.status, 'succeeded');
  await assert.rejects(
    () => issueRefund({
      payment, booking, amount: 201,
      idempotencyKey: `test-refund:${booking._id}:deposit`,
      reason: 'deposit_refund'
    }),
    { errorCode: 'REFUND_IDEMPOTENCY_CONFLICT' }
  );
  await assert.rejects(
    () => issueRefund({
      payment, booking, amount: 801,
      idempotencyKey: `test-refund:${booking._id}:excess`,
      reason: 'booking_cancellation_rental'
    }),
    { errorCode: 'REFUND_EXCEEDS_PAYMENT' }
  );
  assert.equal(await Refund.countDocuments({ payment: payment._id }), 1);
});

test('Razorpay checkout creates one server order and replays idempotent requests', async () => {
  const oldProvider = process.env.PAYMENT_PROVIDER;
  const oldKeyId = process.env.RAZORPAY_KEY_ID;
  const oldSecret = process.env.RAZORPAY_KEY_SECRET;
  const oldJwtSecret = process.env.JWT_SECRET;
  const originalFetch = global.fetch;
  process.env.PAYMENT_PROVIDER = 'razorpay';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'test-payment-secret';
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
  const customer = await User.create({ name: 'Checkout Customer', email: 'checkout-customer@example.com', password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Checkout Owner', email: 'checkout-owner@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Checkout Test Gear', slug: 'checkout-test-gear', description: 'Checkout test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Checkout Test Item',
    description: 'Checkout test item',
    dailyRate: 1000,
    replacementValue: 5000,
    depositAmount: 200,
    location: { city: 'Jaipur' }
  });
  const now = new Date();
  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(now.getTime() + 86400000),
    endDate: new Date(now.getTime() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 1000,
    depositAmount: 200,
    totalAmount: 1200,
    status: 'pending_payment',
    paymentExpiresAt: new Date(now.getTime() + 600000)
  });
  let orderCalls = 0;
  global.fetch = async (_url, options) => {
    if (options.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    orderCalls += 1;
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: 'order_checkout_integration',
      amount: body.amount,
      currency: body.currency,
      receipt: body.receipt
    }), { status: 200 });
  };
  const server = app.listen(0);
  try {
    const token = jwt.sign({ sub: String(customer._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const url = `http://127.0.0.1:${server.address().port}/api/bookings/${booking._id}/pay`;
    const response = await originalFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'checkout-key-0001' },
      body: '{}'
    });
    assert.equal(response.status, 201);
    const responseBody = await response.json();
    assert.equal(responseBody.data.provider, 'razorpay');
    assert.equal(responseBody.data.checkout.amount, 120000);
    assert.equal(orderCalls, 1);

    const replay = await originalFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'checkout-key-0001' },
      body: '{}'
    });
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).data.checkout.orderId, 'order_checkout_integration');
    assert.equal(orderCalls, 1);
    const resumed = await originalFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'checkout-key-0002' },
      body: '{}'
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).data.checkout.orderId, 'order_checkout_integration');
    assert.equal(orderCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    if (oldProvider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = oldProvider;
    if (oldKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = oldKeyId;
    if (oldSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = oldSecret;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
  }
});

test('mock booking payment, cancellation, refunds, and ledger replay are end-to-end idempotent', async () => {
  const oldProvider = process.env.PAYMENT_PROVIDER;
  const oldJwtSecret = process.env.JWT_SECRET;
  process.env.PAYMENT_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
  const customer = await User.create({ name: 'Cancellation Customer', email: 'cancel-customer@example.com', password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Cancellation Owner', email: 'cancel-owner@example.com', password: 'Owner@123', role: 'owner' });
  const category = await Category.create({ name: 'Cancellation Test Gear', slug: 'cancellation-test-gear', description: 'Cancellation test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Cancellation Test Item',
    description: 'Cancellation test item',
    dailyRate: 1000,
    replacementValue: 5000,
    depositAmount: 200,
    location: { city: 'Kochi' }
  });
  const now = new Date();
  const booking = await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment._id],
    startDate: new Date(now.getTime() + 86400000),
    endDate: new Date(now.getTime() + 2 * 86400000),
    rentalDays: 1,
    subtotal: 1000,
    depositAmount: 200,
    totalAmount: 1200,
    status: 'pending_payment',
    paymentExpiresAt: new Date(now.getTime() + 600000)
  });
  const server = app.listen(0);
  try {
    const token = jwt.sign({ sub: String(customer._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/bookings/${booking._id}`;
    const paymentResponse = await fetch(`${baseUrl}/pay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-pay-key-0001' },
      body: '{}'
    });
    assert.equal(paymentResponse.status, 200);
    assert.equal((await paymentResponse.json()).data.booking.status, 'confirmed');
    const cancellationHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'mock-cancel-key-0001'
    };
    const cancellation = await fetch(`${baseUrl}/status`, {
      method: 'PATCH',
      headers: cancellationHeaders,
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(cancellation.status, 200);
    const replay = await fetch(`${baseUrl}/status`, {
      method: 'PATCH',
      headers: cancellationHeaders,
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(replay.status, 200);
    assert.equal((await Booking.findById(booking._id)).status, 'cancelled');
    assert.equal((await Payment.findOne({ booking: booking._id })).status, 'refunded');
    assert.equal((await Deposit.findOne({ booking: booking._id })).status, 'refunded');
    assert.equal(await Refund.countDocuments({ booking: booking._id, status: 'succeeded' }), 2);
    assert.equal(await LedgerEntry.countDocuments({ 'metadata.bookingId': booking._id.toString() }), 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldProvider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = oldProvider;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
  }
});

test('customer cart persists equipment and dates and enforces role access', async () => {
  const oldJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
  const customer = await User.create({ name: 'Cart Customer', email: `cart-customer-${crypto.randomUUID()}@example.com`, password: 'Customer@123', role: 'customer' });
  const owner = await User.create({ name: 'Cart Owner', email: `cart-owner-${crypto.randomUUID()}@example.com`, password: 'Owner@123', role: 'owner' });
  const transporter = await User.create({ name: 'Cart Transporter', email: `cart-transporter-${crypto.randomUUID()}@example.com`, password: 'Driver@123', role: 'transporter' });
  const category = await Category.create({ name: 'Cart Test', slug: `cart-test-${crypto.randomUUID()}`, description: 'Cart test category' });
  const equipment = await Equipment.create({
    owner: owner._id,
    category: category._id,
    name: 'Cart Test Equipment',
    description: 'Persisted cart test equipment',
    dailyRate: 400,
    replacementValue: 4000,
    depositAmount: 500,
    location: { city: 'Pune' }
  });
  await syncAssetForLegacy(equipment);
  const customerToken = jwt.sign({ sub: String(customer._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const transporterToken = jwt.sign({ sub: String(transporter._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/cart`;
  const headers = { Authorization: `Bearer ${customerToken}`, 'Content-Type': 'application/json' };
  const startDate = new Date(Date.now() + 5 * 86400000).toISOString();
  const endDate = new Date(Date.now() + 7 * 86400000).toISOString();
  try {
    const forbidden = await fetch(baseUrl, { headers: { Authorization: `Bearer ${transporterToken}` } });
    assert.equal(forbidden.status, 403);

    const added = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'cart-add-test-0001' },
      body: JSON.stringify({ equipmentId: String(equipment._id), startDate, endDate })
    });
    assert.equal(added.status, 201);
    const addedJson = await added.json();
    assert.equal(addedJson.data.cart.items.length, 1);
    assert.equal(addedJson.data.cart.items[0].rentalDays, 2);
    assert.equal(addedJson.data.cart.totalAmount, 1300);

    const persisted = await fetch(baseUrl, { headers });
    assert.equal((await persisted.json()).data.cart.items.length, 1);

    const updated = await fetch(`${baseUrl}/items/${equipment._id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Idempotency-Key': 'cart-update-test-0001' },
      body: JSON.stringify({
        startDate: new Date(Date.now() + 9 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 12 * 86400000).toISOString()
      })
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).data.cart.items[0].rentalDays, 3);

    const removed = await fetch(`${baseUrl}/items/${equipment._id}`, {
      method: 'DELETE',
      headers: { ...headers, 'Idempotency-Key': 'cart-remove-test-0001' }
    });
    assert.equal(removed.status, 200);
    assert.equal((await Cart.findOne({ customer: customer._id })).items.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
  }
});
