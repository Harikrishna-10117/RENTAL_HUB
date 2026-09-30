const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  quantity: { type: Number, required: true, min: 1, max: 1000, default: 1 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true }
}, { timestamps: true });

const cartSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  items: { type: [cartItemSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);