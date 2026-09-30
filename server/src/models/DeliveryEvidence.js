const mongoose = require('mongoose');

const deliveryEvidenceSchema = new mongoose.Schema({
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, trim: true },
  category: { type: String, default: 'delivery', trim: true },
  url: { type: String, required: true, trim: true },
  timestamp: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryEvidence', deliveryEvidenceSchema);
