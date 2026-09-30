const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, default: '' },
  descriptions: [{ lang: { type: String, trim: true }, value: { type: String, trim: true } }],
  image: { type: String, default: '' },
  names: [{ lang: { type: String, trim: true }, value: { type: String, trim: true } }],
  aliases: [{ type: String, trim: true }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
