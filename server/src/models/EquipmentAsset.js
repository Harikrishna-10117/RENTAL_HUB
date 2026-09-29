const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: [77.5946, 12.9716] },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  district: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: 'Karnataka' },
  pincode: { type: String, trim: true, default: '' },
  country: { type: String, trim: true, default: 'India' },
  formatted: { type: String, trim: true, default: '' }
}, { _id: false });

const equipmentAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, trim: true, unique: true, index: true },
  equipmentType: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentType', required: true, index: true },
  legacyEquipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', unique: true, sparse: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organization: { type: String, default: '', trim: true },
  serialNumber: { type: String, trim: true, default: '' },
  qrCode: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['available', 'reserved', 'rented', 'maintenance', 'retired', 'offline'], default: 'available', index: true },
  condition: { type: String, enum: ['new', 'excellent', 'good', 'fair', 'poor'], default: 'good', index: true },
  lifecycleState: { type: String, enum: ['new', 'listed', 'active', 'in_service', 'maintenance', 'retired'], default: 'listed', index: true },
  dailyRate: { type: Number, min: 0, default: 0 },
  replacementValue: { type: Number, min: 0, default: 0 },
  depositAmount: { type: Number, min: 0, default: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  location: { type: locationSchema, default: () => ({}) },
  images: [{ type: String, trim: true }],
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true, index: true },
  reservationLock: { type: String, default: null },
  reservationLockUntil: { type: Date, default: null },
  lastInspectionAt: { type: Date, default: null },
  nextInspectionAt: { type: Date, default: null },
  searchText: { type: String, default: '' }
}, { timestamps: true });

equipmentAssetSchema.index({ owner: 1, status: 1, active: 1 });
equipmentAssetSchema.index({ 'location.city': 1, status: 1, active: 1 });
equipmentAssetSchema.index({ 'location.coordinates': '2dsphere' });
equipmentAssetSchema.index({ searchText: 'text' });

module.exports = mongoose.model('EquipmentAsset', equipmentAssetSchema);
