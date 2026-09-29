const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  method: { type: String, default: 'mock' },
  status: { type: String, enum: ['pending', 'succeeded', 'failed', 'refunded'], default: 'succeeded' },
  transactionId: { type: String, required: true, unique: true },
  operationKey: { type: String, unique: true, sparse: true },
  providerOrderId: { type: String, unique: true, sparse: true },
  providerPaymentId: { type: String, unique: true, sparse: true },
  providerReceipt: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
