const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PhoneOtpChallenge = require('../models/PhoneOtpChallenge');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { normalizeIndianPhone } = require('../utils/india');
const { normalizeUserRole } = require('../services/userRoles');

function tokenFor(user) {
  if (!process.env.JWT_SECRET) throw new AppError('JWT_SECRET is not configured', 500, 'SERVER_CONFIGURATION_ERROR');
  return jwt.sign({ sub: user.id, role: user.role, ver: user.tokenVersion || 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ownerVerified: user.ownerVerified,
    phone: user.phone,
    preferredLanguage: user.preferredLanguage
  };
}

const register = asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const phone = req.body.phone ? normalizeIndianPhone(req.body.phone) : '';
  if (await User.exists({ email })) throw new AppError('An account with this email already exists', 409, 'EMAIL_IN_USE');
  if (phone && await User.exists({ phone })) throw new AppError('An account with this phone number already exists', 409, 'PHONE_IN_USE');
  if (phone) {
    const challenge = await PhoneOtpChallenge.findOneAndUpdate({
      _id: req.body.phoneOtpChallengeId,
      phone,
      purpose: 'registration',
      verifiedAt: { $ne: null },
      consumedAt: null,
      expiresAt: { $gt: new Date() }
    }, { $set: { consumedAt: new Date() } }, { new: true });
    if (!challenge) throw new AppError('Verify this phone number with OTP before registering', 400, 'PHONE_NOT_VERIFIED');
  }

  let user;
  try {
    user = await User.create({
      name: req.body.name,
      email,
      password: req.body.password,
      phone,
      role: req.body.role || 'customer',
      preferredLanguage: req.body.preferredLanguage || 'en'
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicateField = error.keyPattern?.phone ? 'phone' : 'email';
    const duplicateCode = duplicateField === 'phone' ? 'PHONE_IN_USE' : 'EMAIL_IN_USE';
    throw new AppError(`An account with this ${duplicateField} already exists`, 409, duplicateCode);
  }
  return sendSuccess(res, 'Account created', { user: publicUser(user), token: tokenFor(user) }, 201);
});

const login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(req.body.password))) {
    throw new AppError('Email or password is incorrect', 401, 'INVALID_CREDENTIALS');
  }
  if (!user.active) throw new AppError('Account is unavailable', 403, 'ACCOUNT_UNAVAILABLE');
  await normalizeUserRole(user);
  return sendSuccess(res, 'Signed in', { user: publicUser(user), token: tokenFor(user) });
});

const current = asyncHandler(async (req, res) =>
  sendSuccess(res, 'Current account', { user: publicUser(req.user) })
);

const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+password');
  if (!user || !(await user.comparePassword(req.body.currentPassword))) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
  }
  if (await user.comparePassword(req.body.newPassword)) {
    throw new AppError('New password must be different from the current password', 400, 'PASSWORD_UNCHANGED');
  }
  user.password = req.body.newPassword;
  user.tokenVersion += 1;
  await user.save();
  return sendSuccess(res, 'Password updated. Please sign in again.', null);
});

const logout = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  return sendSuccess(res, 'Signed out', null);
});

module.exports = { register, login, current, changePassword, logout };
