const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Category = require('../src/models/Category');
const Equipment = require('../src/models/Equipment');
const EquipmentType = require('../src/models/EquipmentType');
const EquipmentAsset = require('../src/models/EquipmentAsset');
const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const Deposit = require('../src/models/Deposit');
const Refund = require('../src/models/Refund');
const LedgerEntry = require('../src/models/LedgerEntry');
const WebhookEvent = require('../src/models/WebhookEvent');
const RateLimitBucket = require('../src/models/RateLimitBucket');
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

test('availability only blocks overlapping bookings for the requested equipment', async () => {
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
    location: { city: 'Chennai' }
  })));
  const start = new Date(Date.now() + 3 * 86400000);
  const end = new Date(Date.now() + 4 * 86400000);
  await Booking.create({
    customer: customer._id,
    owner: owner._id,
    equipment: [equipment[0]._id],
    startDate: start,
    endDate: end,
    rentalDays: 1,
    subtotal: 100,
    depositAmount: 100,
    totalAmount: 200,
    status: 'confirmed'
  });

  await assert.rejects(
    () => assertAvailable([equipment[0]._id], start, end),
    { errorCode: 'DATES_UNAVAILABLE' }
  );
  await assert.doesNotReject(() => assertAvailable([equipment[1]._id], start, end));
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
