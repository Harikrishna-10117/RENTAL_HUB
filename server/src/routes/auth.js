const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body } = require('../utils/validation');
const { normalizeIndianPhone } = require('../utils/india');

const router = express.Router();

function tokenFor(user) {
  if (!process.env.JWT_SECRET) throw new AppError('JWT_SECRET is not configured', 500, 'SERVER_CONFIGURATION_ERROR');
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
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
    phone: user.phone
  };
}

router.post('/register',
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('phone').optional({ checkFalsy: true }).custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  body('role').optional().isIn(['customer', 'owner']).withMessage('Role must be customer or owner'),
  validate,
  asyncHandler(async (req, res) => {
    const user = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone ? normalizeIndianPhone(req.body.phone) : '',
      role: req.body.role || 'customer'
    });
    return sendSuccess(res, 'Account created', { user: publicUser(user), token: tokenFor(user) }, 201);
  })
);

router.post('/login',
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(req.body.password))) {
      throw new AppError('Email or password is incorrect', 401, 'INVALID_CREDENTIALS');
    }
    if (!user.active) throw new AppError('Account is unavailable', 403, 'ACCOUNT_UNAVAILABLE');
    return sendSuccess(res, 'Signed in', { user: publicUser(user), token: tokenFor(user) });
  })
);

router.get('/me', protect, asyncHandler(async (req, res) =>
  sendSuccess(res, 'Current account', { user: publicUser(req.user) })
));

module.exports = router;
