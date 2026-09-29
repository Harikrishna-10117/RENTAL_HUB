const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema({
  assetRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentAsset', unique: true, sparse: true, index: true },
  assetId: { type: String, trim: true, sparse: true, unique: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, required: true, trim: true },
  brand: { type: String, default: '' },
  dailyRate: { type: Number, required: true, min: 0 },
  replacementValue: { type: Number, required: true, min: 0 },
  depositAmount: { type: Number, required: true, min: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  location: {
    city: { type: String, required: true, trim: true },
    region: { type: String, default: '' }
  },
  images: [{ type: String }],
  condition: { type: String, enum: ['new', 'excellent', 'good', 'fair'], default: 'good' },
  status: { type: String, enum: ['available', 'unavailable', 'maintenance'], default: 'available', index: true },
  active: { type: Boolean, default: true },
  swapTypes: [{ type: String, enum: ['item_for_item', 'item_plus_cash', 'cash_for_item'] }],
  reservationLock: { type: String, default: null },
  reservationLockUntil: { type: Date, default: null }
}, { timestamps: true });

equipmentSchema.index({ name: 'text', description: 'text', brand: 'text' });
equipmentSchema.index({ 'location.city': 1, dailyRate: 1, category: 1, status: 1 });

module.exports = mongoose.model('Equipment', equipmentSchema);
