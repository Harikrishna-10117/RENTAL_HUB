const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  refundAmount: { type: Number, default: 0, min: 0 },
  deductionAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['held', 'refund_pending', 'refund_failed', 'refunded', 'partially_refunded', 'forfeited'], default: 'held' },
  inspectionNotes: { type: String, default: '' },
  inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  inspectedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Deposit', depositSchema);
