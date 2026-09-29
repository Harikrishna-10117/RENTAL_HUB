const mongoose = require('mongoose');

const swapRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
  offeredEquipment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Equipment',
    required() { return this.swapType !== 'cash_for_item'; }
  },
  requestedEquipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  swapType: { type: String, enum: ['item_for_item', 'item_plus_cash', 'cash_for_item'], required: true },
  cashDifference: { type: Number, required: true },
  rentalType: { type: String, enum: ['UPGRADE', 'DOWNGRADE', 'FAILURE_REPLACEMENT'] },
  remainingRentalDays: { type: Number, min: 0 },
  rentalDifference: { type: Number, default: 0 },
  depositDifference: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending', index: true },
  message: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SwapRequest', swapRequestSchema);
