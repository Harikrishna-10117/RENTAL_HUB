const mongoose = require('mongoose');

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

const equipmentSchema = new mongoose.Schema({
  assetRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentAsset', unique: true, sparse: true, index: true },
  assetId: { type: String, trim: true, sparse: true, unique: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  brand: { type: String, trim: true, maxlength: 100, default: '' },
  model: { type: String, trim: true, maxlength: 100, default: '' },
  manufacturingYear: { type: Number, min: 1900, max: new Date().getFullYear() + 1, default: null },
  specifications: { type: [specificationSchema], default: [] },
  dimensions: { type: dimensionsSchema, default: () => ({}) },
  weight: { type: weightSchema, default: () => ({}) },
  operatingRequirements: { type: requirementSchema, default: () => ({}) },
  operatorRequirement: { type: requirementSchema, default: () => ({}) },
  transportRequirements: { type: requirementSchema, default: () => ({}) },
  dailyRate: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1, max: 1000, default: 1 },
  replacementValue: { type: Number, required: true, min: 0 },
  depositAmount: { type: Number, required: true, min: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  location: {
    city: { type: String, required: true, trim: true },
    region: { type: String, default: '' }
  },
  images: [{ type: String, trim: true, maxlength: 2048 }],
  condition: { type: String, enum: ['new', 'excellent', 'good', 'fair'], default: 'good' },
  status: { type: String, enum: ['available', 'unavailable', 'maintenance'], default: 'available', index: true },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
  active: { type: Boolean, default: true },
  swapTypes: [{ type: String, enum: ['item_for_item', 'item_plus_cash', 'cash_for_item'] }],
  reservationLock: { type: String, default: null },
  reservationLockUntil: { type: Date, default: null }
}, { timestamps: true });

equipmentSchema.index({ name: 'text', description: 'text', brand: 'text' });
equipmentSchema.index({ 'location.city': 1, dailyRate: 1, category: 1, status: 1 });
equipmentSchema.index({ owner: 1, active: 1, createdAt: -1 });
equipmentSchema.index({ active: 1, status: 1, verificationStatus: 1, category: 1 });

module.exports = mongoose.model('Equipment', equipmentSchema);
