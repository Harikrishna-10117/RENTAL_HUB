const mongoose = require('mongoose');

const maintenanceRecordSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blockPeriod: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentBlockPeriod', default: null, index: true },
  type: { type: String, enum: ['scheduled', 'repair', 'inspection'], default: 'scheduled' },
  serviceDate: { type: Date, default: null },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  meterReading: { type: String, trim: true, maxlength: 100, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  cost: { type: Number, min: 0, default: 0 },
  nextServiceDate: { type: Date, default: null },
  status: { type: String, enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], default: 'SCHEDULED', index: true }
}, { timestamps: true });

maintenanceRecordSchema.index({ equipment: 1, status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('MaintenanceRecord', maintenanceRecordSchema);