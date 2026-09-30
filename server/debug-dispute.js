const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const app = require('./src/app');
const User = require('./src/models/User');
const Category = require('./src/models/Category');
const Equipment = require('./src/models/Equipment');
const Booking = require('./src/models/Booking');
const Rental = require('./src/models/Rental');
const DeliveryIssue = require('./src/models/DeliveryIssue');
(async () => {
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'debug-dispute' });
  process.env.JWT_SECRET = 'dispute-test-secret-at-least-32-characters-long';

  const owner = await User.create({ name: 'Dispute Owner', email: `dispute-owner-${crypto.randomUUID()}@example.com`, password: 'DisputeOwner@123', role: 'owner' });
  const customer = await User.create({ name: 'Dispute Customer', email: `dispute-customer-${crypto.randomUUID()}@example.com`, password: 'DisputeCustomer@123', role: 'customer' });
  const outsider = await User.create({ name: 'Dispute Outsider', email: `dispute-outsider-${crypto.randomUUID()}@example.com`, password: 'DisputeOutsider@123', role: 'customer' });
  const admin = await User.create({ name: 'Dispute Admin', email: `dispute-admin-${crypto.randomUUID()}@example.com`, password: 'DisputeAdmin@123', role: 'admin' });
  const category = await Category.create({ name: `Dispute ${crypto.randomUUID()}`, slug: `dispute-${crypto.randomUUID()}` });
  const equipment = await Equipment.create({ owner: owner._id, category: category._id, name: 'Disputed Equipment', description: 'Dispute integration item', dailyRate: 100, replacementValue: 1000, depositAmount: 50, location: { city: 'Chennai' } });
  const startDate = new Date(Date.now() + 4 * 86400000);
  const endDate = new Date(Date.now() + 6 * 86400000);
  const booking = await Booking.create({ customer: customer._id, owner: owner._id, equipment: [equipment._id], startDate, endDate, rentalDays: 2, subtotal: 200, depositAmount: 50, totalAmount: 250, status: 'confirmed' });
  const rental = await Rental.create({ booking: booking._id, customer: customer._id, owner: owner._id, equipment: [equipment._id], startDate, endDate, rentalDays: 2, pricing: { rentalSubtotal: 200, securityDeposit: 50, grandTotal: 250 }, status: 'ACTIVE', paymentStatus: 'PAID' });
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
      rentalId: String(rental._id), equipmentId: String(equipment._id),
      disputeType: 'damage', summary: 'Visible damage was present at handover', notes: 'Please review the uploaded evidence.'
    });
    const createdBody = await created.json();
    console.log('created', created.status, JSON.stringify(createdBody));
    disputeId = createdBody.data._id;
    console.log('rental after create', (await Rental.findById(rental._id)).status);

    const outsiderRead = await request(`/api/disputes/${disputeId}`, outsiderToken);
    console.log('outsiderRead', outsiderRead.status);

    const ownerResponse = await request(`/api/disputes/${disputeId}/responses`, ownerToken, 'POST', { message: 'We will review the condition report.' });
    console.log('ownerResponse', ownerResponse.status, await ownerResponse.text());

    const ownerView = await request(`/api/disputes/${disputeId}`, ownerToken);
    const ownerViewJson = await ownerView.json();
    console.log('ownerView', ownerView.status, JSON.stringify(ownerViewJson.data.responses));

    const customerResolve = await request(`/api/disputes/${disputeId}/status`, customerToken, 'PATCH', { status: 'resolved', resolution: 'Reviewed' });
    console.log('customerResolve', customerResolve.status, await customerResolve.text());

    const adminReview = await request(`/api/disputes/${disputeId}/status`, adminToken, 'PATCH', { status: 'under_review' });
    console.log('adminReview', adminReview.status, await adminReview.text());

    const adminResolve = await request(`/api/disputes/${disputeId}/status`, adminToken, 'PATCH', { status: 'resolved', resolution: 'Evidence reviewed by support.' });
    console.log('adminResolve', adminResolve.status, await adminResolve.text());

    const storedDispute = await DeliveryIssue.findById(disputeId);
    console.log('storedDispute', storedDispute.status, storedDispute.resolution, storedDispute.responses.length);
    console.log('rental after resolve', (await Rental.findById(rental._id)).status);
  } finally {
    if (disputeId) await DeliveryIssue.deleteOne({ _id: disputeId });
    await Rental.deleteOne({ _id: rental._id });
    await Booking.deleteOne({ _id: booking._id });
    await Equipment.deleteOne({ _id: equipment._id });
    await Category.deleteOne({ _id: category._id });
    await User.deleteMany({ _id: { $in: [owner._id, customer._id, outsider._id, admin._id] } });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongoServer.stop();
  }
})();
