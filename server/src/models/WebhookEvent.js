const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, maxlength: 160 },
  eventType: { type: String, required: true, maxlength: 100 },
  payloadHash: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed'], default: 'processing', index: true },
  leaseUntil: { type: Date, required: true },
  processedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
