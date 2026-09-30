const mongoose = require('mongoose');

const handoverAcknowledgementSchema = new mongoose.Schema({
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customerAcknowledged: { type: Boolean, default: false },
  transporterAcknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date, default: null },
  deviceInfo: { type: String, default: '' },
  sessionInfo: { type: String, default: '' },
  location: { type: mongoose.Schema.Types.Mixed, default: null },
  conditionReport: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryConditionReport', default: null }
}, { timestamps: true });

handoverAcknowledgementSchema.index({ delivery: 1, rental: 1 }, { unique: true });

module.exports = mongoose.model('HandoverAcknowledgement', handoverAcknowledgementSchema);
