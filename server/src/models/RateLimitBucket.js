const mongoose = require('mongoose');

const rateLimitBucketSchema = new mongoose.Schema({
  bucketKey: { type: String, required: true, unique: true },
  count: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
