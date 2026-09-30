const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: undefined },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  district: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: 'Karnataka' },
  pincode: { type: String, trim: true, default: '' },
  country: { type: String, trim: true, default: 'India' },
  formatted: { type: String, trim: true, default: '' }
}, { _id: false });

const specificationSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, maxlength: 80 },
  value: { type: String, required: true, trim: true, maxlength: 300 },
  unit: { type: String, trim: true, maxlength: 30, default: '' }
}, { _id: false });

const dimensionsSchema = new mongoose.Schema({
  length: { type: Number, min: 0 },
  width: { type: Number, min: 0 },
  height: { type: Number, min: 0 },
  unit: { type: String, enum: ['mm', 'cm', 'm', 'in', 'ft'], default: 'cm' }
}, { _id: false });

const weightSchema = new mongoose.Schema({
  value: { type: Number, min: 0 },
  unit: { type: String, enum: ['g', 'kg', 'lb'], default: 'kg' }
}, { _id: false });

const requirementSchema = new mongoose.Schema({
  required: { type: Boolean, default: false },
  method: { type: String, trim: true, maxlength: 100, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' }
}, { _id: false });

const equipmentAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, trim: true, unique: true, index: true },
  equipmentType: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentType', required: true, index: true },
  legacyEquipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', unique: true, sparse: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organization: { type: String, default: '', trim: true },
  name: { type: String, trim: true, maxlength: 140, default: '' },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  brand: { type: String, trim: true, maxlength: 100, default: '' },
  model: { type: String, trim: true, maxlength: 100, default: '' },
  manufacturingYear: { type: Number, min: 1900, max: new Date().getFullYear() + 1, default: null },
  specifications: { type: [specificationSchema], default: [] },
  dimensions: { type: dimensionsSchema, default: () => ({}) },
  weight: { type: weightSchema, default: () => ({}) },
  operatingRequirements: { type: requirementSchema, default: () => ({}) },
  operatorRequirement: { type: requirementSchema, default: () => ({}) },
  transportRequirements: { type: requirementSchema, default: () => ({}) },
  serialNumber: { type: String, trim: true, default: '' },
  qrCode: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['available', 'reserved', 'rented', 'maintenance', 'retired', 'offline'], default: 'available', index: true },
  condition: { type: String, enum: ['new', 'excellent', 'good', 'fair', 'poor'], default: 'good', index: true },
  lifecycleState: { type: String, enum: ['new', 'listed', 'active', 'in_service', 'maintenance', 'retired'], default: 'listed', index: true },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
  dailyRate: { type: Number, min: 0, default: 0 },
  quantity: { type: Number, min: 1, max: 1000, default: 1 },
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
