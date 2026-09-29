const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 200 },
  receipt: { type: String, required: true, unique: true, maxlength: 40 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, default: 'INR' },
  provider: { type: String, enum: ['mock', 'razorpay'], required: true },
  providerRefundId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending', index: true },
  reason: { type: String, default: '', maxlength: 200 },
  leaseToken: { type: String },
  leaseUntil: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Refund', refundSchema);
