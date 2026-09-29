const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema({
  principal: { type: String, required: true },
  scope: { type: String, required: true },
  key: { type: String, required: true, maxlength: 128 },
  requestHash: { type: String, required: true },
  status: { type: String, enum: ['processing', 'completed'], default: 'processing', required: true },
  responseStatus: { type: Number, min: 100, max: 599 },
  responseBody: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

idempotencyRecordSchema.index({ principal: 1, scope: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
