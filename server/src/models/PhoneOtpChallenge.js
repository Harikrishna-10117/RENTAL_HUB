const mongoose = require('mongoose');

const phoneOtpChallengeSchema = new mongoose.Schema({
  phone: { type: String, required: true, trim: true, index: true },
  purpose: { type: String, enum: ['registration', 'login'], required: true },
  codeSalt: { type: String, required: true, select: false },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  verifiedAt: { type: Date, default: null },
  consumedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0, min: 0, max: 5 }
}, { timestamps: true });

module.exports = mongoose.model('PhoneOtpChallenge', phoneOtpChallengeSchema);