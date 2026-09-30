const express = require('express');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body } = require('../validators');
const { normalizeIndianPhone } = require('../utils/india');
const idempotency = require('../middleware/idempotency');
const { isRazorpayEnabled, verifyCheckoutSignature, fetchPayment } = require('../services/razorpay');
const { finalizeCapturedPayment } = require('../services/paymentLifecycle');
const { toMinorUnits } = require('../services/ledger');

const users = express.Router();
users.use(protect);

function presentProfile(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl || '',
    role: user.role,
    address: user.address?.toObject ? user.address.toObject() : user.address || {},
    preferredLanguage: user.preferredLanguage,
    createdAt: user.createdAt,
    ...(user.role === 'owner' ? {
      businessName: user.businessName,
      shopName: user.businessName,
      businessType: user.businessType,
      businessDescription: user.businessDescription,
      ownerVerified: user.ownerVerified,
      verificationStatus: user.ownerVerified ? 'verified'
        : user.verificationStatus === 'rejected' ? 'rejected' : 'pending'
    } : {}),
    ...(user.role === 'transporter' ? { vehicleInfo: user.vehicleInfo, serviceArea: user.serviceArea } : {}),
  };
}

users.get('/me', asyncHandler(async (req, res) => {
  return sendSuccess(res, 'Your profile', { profile: presentProfile(req.user) });
}));

users.patch('/me',
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('email').optional().trim().isEmail(),
  body('phone').optional({ checkFalsy: true }).custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  body('profileImageUrl').optional({ checkFalsy: true }).custom((value) => {
    if (/^\/api\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(value)) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }).withMessage('Profile image must use a secure image URL'),
  body('address').optional().isObject({ strict: true }).withMessage('Address must be an object'),
  body('address.line1').optional().trim().isLength({ max: 160 }),
  body('address.line2').optional().trim().isLength({ max: 160 }),
  body('address.city').optional().trim().isLength({ max: 100 }),
  body('address.region').optional().trim().isLength({ max: 100 }),
  body('address.postalCode').optional().trim().isLength({ max: 20 }),
  body('address.country').optional().trim().isLength({ max: 80 }),
  body('preferredLanguage').optional().isIn(['en', 'hi', 'ta']),
  body('businessName').optional().trim().isLength({ max: 120 }),
  body('shopName').optional().trim().isLength({ max: 120 }),
  body('businessType').optional().trim().isLength({ max: 80 }),
  body('businessDescription').optional().trim().isLength({ max: 1000 }),
  body('vehicleInfo').optional().isObject({ strict: true }),
  body('vehicleInfo.vehicleType').optional().trim().isLength({ max: 80 }),
  body('vehicleInfo.makeModel').optional().trim().isLength({ max: 120 }),
  body('vehicleInfo.registrationNumber').optional().trim().isLength({ max: 30 }),
  body('serviceArea').optional().isObject({ strict: true }),
  ...['cities', 'states', 'pincodes'].flatMap((field) => [
    body(`serviceArea.${field}`).optional().isArray({ max: 30 }),
    body(`serviceArea.${field}.*`).optional().trim().isLength({ min: 1, max: field === 'pincodes' ? 10 : 100 })
  ]),
  validate,
  asyncHandler(async (req, res) => {
    const fields = [
      'name', 'email', 'phone', 'address', 'preferredLanguage',
      'profileImageUrl', 'businessName', 'shopName', 'businessType', 'businessDescription',
      'vehicleInfo', 'serviceArea'
    ];
    if (!fields.some((field) => req.body[field] !== undefined)) {
      throw new AppError('Provide at least one profile field to update', 400, 'VALIDATION_ERROR');
    }
    const businessFields = ['businessName', 'shopName', 'businessType', 'businessDescription'];
    if (req.user.role !== 'owner' && businessFields.some((field) => req.body[field] !== undefined)) {
      throw new AppError('Only owners can update business information', 403, 'FORBIDDEN');
    }
    if (req.user.role !== 'transporter' && req.body.vehicleInfo !== undefined) {
      throw new AppError('Only transporters can update vehicle information', 403, 'FORBIDDEN');
    }
    if (req.user.role !== 'transporter' && req.body.serviceArea !== undefined) {
      throw new AppError('Only transporters can update service areas', 403, 'FORBIDDEN');
    }
    const email = req.body.email === undefined ? undefined : req.body.email.toLowerCase();
    const phone = req.body.phone === undefined ? undefined : req.body.phone ? normalizeIndianPhone(req.body.phone) : '';
    if (email && await User.exists({ _id: { $ne: req.user.id }, email })) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_IN_USE');
    }
    if (phone && await User.exists({ _id: { $ne: req.user.id }, phone })) {
      throw new AppError('An account with this phone number already exists', 409, 'PHONE_IN_USE');
    }
    const user = req.user;
    if (req.body.name !== undefined) user.name = req.body.name.trim();
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (req.body.profileImageUrl !== undefined) user.profileImageUrl = req.body.profileImageUrl.trim();
    if (req.body.address !== undefined) {
      const currentAddress = user.address?.toObject ? user.address.toObject() : user.address || {};
      user.address = { ...currentAddress, ...req.body.address };
    }
    if (req.body.preferredLanguage !== undefined) user.preferredLanguage = req.body.preferredLanguage;
    if (req.body.businessName !== undefined || req.body.shopName !== undefined) {
      user.businessName = (req.body.shopName ?? req.body.businessName).trim();
    }
    for (const field of ['businessType', 'businessDescription']) {
      if (req.body[field] !== undefined) user[field] = req.body[field].trim();
    }
    if (req.body.vehicleInfo !== undefined) {
      user.vehicleInfo = { ...(user.vehicleInfo?.toObject?.() || user.vehicleInfo || {}), ...req.body.vehicleInfo };
    }
    if (req.body.serviceArea !== undefined) {
      user.serviceArea = { ...(user.serviceArea?.toObject?.() || user.serviceArea || {}), ...req.body.serviceArea };
    }
    try {
      await user.save();
    } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicateField = error.keyPattern?.phone ? 'phone' : 'email';
      const duplicateCode = duplicateField === 'phone' ? 'PHONE_IN_USE' : 'EMAIL_IN_USE';
      throw new AppError(`An account with this ${duplicateField} already exists`, 409, duplicateCode);
    }
    return sendSuccess(res, 'Profile updated', { profile: presentProfile(user) });
  })
);

const payments = express.Router();
payments.use(protect, allowRoles('customer'));
payments.use((req, res, next) => (
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? idempotency(req, res, next) : next()
));
payments.get('/my', asyncHandler(async (req, res) => {
  const records = await Payment.find({ customer: req.user.id })
    .populate({ path: 'booking', populate: { path: 'equipment', select: 'name' } })
    .sort({ createdAt: -1 });
  const refunds = await Refund.find({ payment: { $in: records.map((record) => record._id) } }).sort({ createdAt: -1 });
  const refundsByPayment = new Map();
  for (const refund of refunds) {
    const key = String(refund.payment);
    const items = refundsByPayment.get(key) || [];
    items.push(refund);
    refundsByPayment.set(key, items);
  }
  return sendSuccess(res, 'Your payments', records.map((record) => ({
    ...record.toObject(),
    refunds: refundsByPayment.get(String(record._id)) || []
  })));
}));
payments.post('/razorpay/verify',
  body('razorpay_order_id').isString().notEmpty().isLength({ max: 100 }),
  body('razorpay_payment_id').isString().notEmpty().isLength({ max: 100 }),
  body('razorpay_signature').isString().notEmpty().isLength({ max: 128 }),
  validate,
  asyncHandler(async (req, res) => {
    if (!isRazorpayEnabled()) throw new AppError('Razorpay checkout is not enabled', 404, 'NOT_FOUND');
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
      throw new AppError('Payment signature is invalid', 400, 'INVALID_PAYMENT_SIGNATURE');
    }
    const payment = await Payment.findOne({
      booking: { $exists: true },
      customer: req.user.id,
      providerOrderId: orderId,
      method: 'razorpay'
    });
    if (!payment) throw new AppError('Payment order was not found', 404, 'PAYMENT_NOT_FOUND');
    const providerPayment = await fetchPayment(paymentId);
    if (providerPayment.order_id !== orderId ||
      providerPayment.amount !== toMinorUnits(payment.amount) ||
      providerPayment.currency !== (payment.currency || 'INR')) {
      throw new AppError('Payment details do not match the checkout order', 409, 'PAYMENT_DETAILS_MISMATCH');
    }
    if (providerPayment.status !== 'captured') {
      throw new AppError('Payment has not been captured yet; confirmation will follow from the payment provider', 409, 'PAYMENT_NOT_CAPTURED');
    }
    const result = await finalizeCapturedPayment(payment, paymentId);
    const message = result.refundPending
      ? 'Payment was received after the reservation expired; refund processing has started'
      : result.refunded
        ? 'Payment was received after cancellation and has been refunded'
        : 'Razorpay payment verified and booking confirmed';
    return sendSuccess(res, message, result);
  })
);

module.exports = { users, payments };
