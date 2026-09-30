const express = require('express');
const crypto = require('node:crypto');
const { body } = require('../validators');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { normalizeIndianPhone } = require('../utils/india');
const authController = require('../controllers/auth');
const PhoneOtpChallenge = require('../models/PhoneOtpChallenge');
const PasswordResetToken = require('../models/PasswordResetToken');
const User = require('../models/User');
const otpService = require('../services/otp');
const passwordResetService = require('../services/passwordReset');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');

const router = express.Router();

router.post('/register',
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required').customSanitizer((value) => value.toLowerCase()),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72)
    .withMessage('Password must not exceed 72 bytes'),
  body('phone').optional({ checkFalsy: true }).custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  body('phoneOtpChallengeId').optional().isMongoId().withMessage('A valid phone OTP challenge is required'),
  body('role').optional().customSanitizer((value) => String(value).toLowerCase())
    .isIn(['customer', 'owner', 'transporter'])
    .withMessage('Role must be customer, owner, or transporter'),
  body('preferredLanguage').optional().isIn(['en', 'hi', 'ta'])
    .withMessage('Preferred language must be en, hi, or ta'),
  validate,
  authController.register
);

router.post('/login',
  body('email').trim().isEmail().withMessage('Valid email is required').customSanitizer((value) => value.toLowerCase()),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
  authController.login
);

router.post('/forgot-password',
  body('email').trim().isEmail().withMessage('Valid email is required').customSanitizer((value) => value.toLowerCase()),
  validate,
  asyncHandler(async (req, res) => {
    if (!passwordResetService.isConfigured()) {
      throw new AppError('Password reset service not configured', 503, 'PASSWORD_RESET_NOT_CONFIGURED');
    }
    const user = await User.findOne({ email: req.body.email, active: true });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const resetToken = await PasswordResetToken.create({
        user: user._id,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      try {
        await passwordResetService.sendResetLink(user.email, token);
      } catch (error) {
        await PasswordResetToken.deleteOne({ _id: resetToken._id });
        throw error;
      }
    }
    return sendSuccess(res, 'If an account exists, a password reset link has been sent.', null);
  })
);

router.post('/reset-password',
  body('token').isString().matches(/^[a-f0-9]{64}$/i).withMessage('A valid reset token is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72)
    .withMessage('New password must not exceed 72 bytes'),
  validate,
  asyncHandler(async (req, res) => {
    const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
    const resetToken = await PasswordResetToken.findOneAndUpdate(
      { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    );
    if (!resetToken) throw new AppError('Reset token is invalid or expired', 400, 'INVALID_RESET_TOKEN');

    const user = await User.findById(resetToken.user).select('+password');
    if (!user || !user.active) throw new AppError('Reset token is invalid or expired', 400, 'INVALID_RESET_TOKEN');
    user.password = req.body.newPassword;
    user.tokenVersion += 1;
    await user.save();
    await PasswordResetToken.deleteMany({ user: user._id, _id: { $ne: resetToken._id } });
    return sendSuccess(res, 'Password reset. Please sign in with your new password.', null);
  })
);

router.post('/phone/otp/request',
  body('phone').custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  body('purpose').optional().isIn(['registration', 'login']).withMessage('Purpose must be registration or login'),
  validate,
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Development OTP is disabled in production', 503, 'OTP_NOT_CONFIGURED');
    }
    const phone = normalizeIndianPhone(req.body.phone);
    const purpose = req.body.purpose || 'registration';
    const { code, salt, hash } = otpService.createCode();
    const challenge = await PhoneOtpChallenge.create({
      phone,
      purpose,
      codeSalt: salt,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });
    return sendSuccess(res, 'OTP request accepted', {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
      developmentCode: code,
      developmentOnly: true
    }, 202);
  })
);

router.post('/phone/otp/verify',
  body('phone').custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  body('challengeId').isMongoId().withMessage('A valid OTP challenge is required'),
  body('code').isString().matches(/^\d{6}$/).withMessage('OTP must contain 6 digits'),
  validate,
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Development OTP is disabled in production', 503, 'OTP_NOT_CONFIGURED');
    }
    const phone = normalizeIndianPhone(req.body.phone);
    const challenge = await PhoneOtpChallenge.findOne({
      _id: req.body.challengeId,
      phone,
      verifiedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 }
    }).select('+codeHash +codeSalt');
    if (!challenge) throw new AppError('OTP challenge is invalid or expired', 400, 'INVALID_OTP_CHALLENGE');

    const verified = otpService.verifyCode(req.body.code, challenge.codeSalt, challenge.codeHash);
    challenge.attempts += 1;
    if (verified) challenge.verifiedAt = new Date();
    await challenge.save();
    if (!verified) throw new AppError('OTP is invalid or expired', 400, 'INVALID_OTP');
    return sendSuccess(res, 'Phone number verified', {
      challengeId: challenge.id,
      phone,
      purpose: challenge.purpose,
      verifiedAt: challenge.verifiedAt
    });
  })
);

router.get('/me', protect, authController.current);
router.patch('/password',
  protect,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72)
    .withMessage('New password must not exceed 72 bytes'),
  validate,
  authController.changePassword
);
router.post('/logout', protect, authController.logout);

module.exports = router;
