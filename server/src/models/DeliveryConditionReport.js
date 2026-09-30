const mongoose = require('mongoose');

const deliveryEvidenceSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const conditionChecklistSchema = new mongoose.Schema({
  scratches: { type: String, default: '' },
  dents: { type: String, default: '' },
  cracks: { type: String, default: '' },
  brokenComponents: { type: String, default: '' },
  missingComponents: { type: String, default: '' },
  tyreCondition: { type: String, default: '' },
  externalBodyCondition: { type: String, default: '' },
  accessoriesIncluded: { type: [String], default: [] },
  attachmentsIncluded: { type: [String], default: [] },
  safetyEquipment: { type: [String], default: [] },
  meterReading: { type: String, default: '' },
  existingDamage: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { _id: false });

const deliveryConditionReportSchema = new mongoose.Schema({
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  conditionStatus: { type: String, enum: ['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL'], default: 'GOOD' },
  overallCondition: { type: String, enum: ['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL'], default: 'GOOD' },
  checklist: { type: conditionChecklistSchema, default: () => ({}) },
  photos: { type: [deliveryEvidenceSchema], default: [] },
  existingDamage: { type: String, default: '' },
  missingComponents: { type: [String], default: [] },
  accessoriesIncluded: { type: [String], default: [] },
  attachmentsIncluded: { type: [String], default: [] },
  usageReading: { type: String, default: '' },
  notes: { type: String, default: '' },
  recordedAt: { type: Date, default: Date.now },
  acknowledged: { type: Boolean, default: false },
  acknowledgementTimestamp: { type: Date, default: null }
}, { timestamps: true });

deliveryConditionReportSchema.index({ delivery: 1, rental: 1 }, { unique: true });

module.exports = mongoose.model('DeliveryConditionReport', deliveryConditionReportSchema);
