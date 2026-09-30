const mongoose = require('mongoose');

const deliveryLocationSchema = new mongoose.Schema({
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  accuracyMeters: { type: Number, min: 0, default: null },
  recordedAt: { type: Date, required: true, index: { expires: 2592000 } }
}, { timestamps: true });

deliveryLocationSchema.index({ delivery: 1, recordedAt: -1 });

module.exports = mongoose.model('DeliveryLocation', deliveryLocationSchema);