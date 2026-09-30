const mongoose = require('mongoose');

const equipmentBlockPeriodSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  quantity: { type: Number, min: 1, max: 1000, default: null },
  type: { type: String, enum: ['MAINTENANCE', 'BLOCKED'], required: true, index: true },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

equipmentBlockPeriodSchema.index({ equipment: 1, active: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('EquipmentBlockPeriod', equipmentBlockPeriodSchema);