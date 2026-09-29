const mongoose = require('mongoose');

const equipmentEventSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('EquipmentEvent', equipmentEventSchema);
