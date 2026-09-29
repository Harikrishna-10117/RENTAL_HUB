const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  equipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true }],
  dailyRate: { type: Number, min: 0 },
  currency: { type: String, uppercase: true, default: 'INR' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);
