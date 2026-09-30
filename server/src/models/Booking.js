const mongoose = require('mongoose');

const equipmentQuantitySchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  quantity: { type: Number, required: true, min: 1, max: 1000, default: 1 }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  equipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true }],
  equipmentQuantities: { type: [equipmentQuantitySchema], default: [] },
  assets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentAsset', index: true }],
  requestedEquipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment' }],
  package: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  rentalDays: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true },
  depositAmount: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  currency: { type: String, uppercase: true, default: 'INR' },
  status: {
    type: String,
    enum: ['pending_payment', 'payment_processing', 'approved', 'confirmed', 'in_progress', 'return_pending', 'completed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  paymentExpiresAt: { type: Date, default: null, index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
  hold: { type: mongoose.Schema.Types.ObjectId, ref: 'ReservationHold' },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', default: null, index: true },
  deliveries: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' }],
  notes: { type: String, default: '' },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancellationReason: { type: String, trim: true, maxlength: 1000, default: '' },
  cancelledAt: { type: Date, default: null },
  depositRefunded: { type: Boolean, default: false }
}, { timestamps: true });

bookingSchema.index({ equipment: 1, status: 1, startDate: 1, endDate: 1 });
bookingSchema.index({ assets: 1, status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
