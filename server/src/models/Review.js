const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', default: null, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '', maxlength: 2000 }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);
