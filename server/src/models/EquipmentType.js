const mongoose = require('mongoose');

const equipmentTypeSchema = new mongoose.Schema({
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  typeCode: { type: String, trim: true, uppercase: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  description: { type: String, default: '' },
  shortDescription: { type: String, default: '' },
  brand: { type: String, default: '' },
  names: [{ lang: { type: String, trim: true }, value: { type: String, trim: true } }],
  aliases: [{ type: String, trim: true }],
  searchTerms: [{ type: String, trim: true }],
  taskTerms: [{ type: String, trim: true }],
  defaultDailyRate: { type: Number, min: 0, default: 0 },
  replacementValue: { type: Number, min: 0, default: 0 },
  depositAmount: { type: Number, min: 0, default: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  specs: [{ key: { type: String, trim: true }, value: { type: String, trim: true }, unit: { type: String, trim: true } }],
  tags: [{ type: String, trim: true }],
  imageUrls: [{ type: String, trim: true }],
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

equipmentTypeSchema.index({ name: 'text', description: 'text', brand: 'text', aliases: 'text', searchTerms: 'text', taskTerms: 'text' });
equipmentTypeSchema.index({ category: 1, active: 1, slug: 1 });
equipmentTypeSchema.index({ defaultDailyRate: 1, depositAmount: 1 });

module.exports = mongoose.model('EquipmentType', equipmentTypeSchema);
