const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  status: { type: String, enum: ['scheduled', 'out_for_delivery', 'delivered', 'pickup_scheduled', 'returned'], default: 'scheduled' },
  address: { type: String, required: true },
  scheduledAt: Date,
  deliveredAt: Date,
  returnedAt: Date,
  notes: { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Delivery', deliverySchema);
