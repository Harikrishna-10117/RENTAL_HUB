const mongoose = require('mongoose');

const returnConditionReportSchema = new mongoose.Schema({
  returnRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalReturn', required: true, index: true },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  inspector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  conditionAtDelivery: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryConditionReport', default: null },
  condition: { type: String, enum: ['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL'], required: true },
  checklist: {
    scratches: { type: String, default: '' },
    dents: { type: String, default: '' },
    cracks: { type: String, default: '' },
    brokenComponents: { type: String, default: '' },
    missingComponents: { type: [String], default: [] },
    tyreCondition: { type: String, default: '' },
    externalBodyCondition: { type: String, default: '' },
    accessories: { type: [String], default: [] },
    attachments: { type: [String], default: [] },
    safetyEquipment: { type: [String], default: [] },
    meterReading: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  damage: { type: String, trim: true, maxlength: 2000, default: '' },
  photos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryEvidence' }],
  evidenceUrls: [{ type: String, trim: true, maxlength: 2048 }],
  location: { type: mongoose.Schema.Types.Mixed, default: null },
  inspectedAt: { type: Date, default: Date.now }
}, { timestamps: true });

returnConditionReportSchema.index({ returnRecord: 1, equipment: 1 }, { unique: true });

module.exports = mongoose.model('ReturnConditionReport', returnConditionReportSchema);