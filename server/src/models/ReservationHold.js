const mongoose = require('mongoose');

const reservationHoldSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  equipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true }],
  assets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentAsset', index: true }],
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['active', 'converted', 'released', 'expired'], default: 'active', index: true }
}, { timestamps: true });

reservationHoldSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
reservationHoldSchema.index({ equipment: 1, status: 1, startDate: 1, endDate: 1 });
reservationHoldSchema.index({ assets: 1, status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('ReservationHold', reservationHoldSchema);
