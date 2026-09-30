const mongoose = require('mongoose');

const rentalReturnSchema = new mongoose.Schema({
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, unique: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  equipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true }],
  deliveries: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' }],
  status: {
    type: String,
    enum: ['REQUESTED', 'RETURN_ASSIGNED', 'RETURN_PICKUP_PENDING', 'RETURN_PICKED_UP', 'RETURN_IN_TRANSIT', 'RETURN_ARRIVED', 'RETURN_INSPECTION', 'RETURN_COMPLETED', 'FAILED', 'CANCELLED'],
    default: 'REQUESTED',
    index: true
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  notes: { type: String, trim: true, maxlength: 2000, default: '' }
}, { timestamps: true });

rentalReturnSchema.index({ owner: 1, status: 1, createdAt: -1 });
rentalReturnSchema.index({ customer: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('RentalReturn', rentalReturnSchema);