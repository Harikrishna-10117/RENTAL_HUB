const express = require('express');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body } = require('../utils/validation');
const { normalizeIndianPhone } = require('../utils/india');
const idempotency = require('../middleware/idempotency');
const { isRazorpayEnabled, verifyCheckoutSignature, fetchPayment } = require('../services/razorpay');
const { finalizeCapturedPayment } = require('../services/paymentLifecycle');
const { toMinorUnits } = require('../services/ledger');

const users = express.Router();
users.use(protect);

users.patch('/me',
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('email').optional().isEmail(),
  body('phone').optional({ checkFalsy: true }).custom((value) => Boolean(normalizeIndianPhone(value))).withMessage('Phone must be a valid Indian mobile number'),
  validate,
  asyncHandler(async (req, res) => {
    const fields = ['name', 'email', 'phone'];
    if (!fields.some((field) => req.body[field] !== undefined)) {
      throw new AppError('Provide at least one profile field to update', 400, 'VALIDATION_ERROR');
    }
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.email !== undefined) updates.email = req.body.email.toLowerCase();
    if (req.body.phone !== undefined) updates.phone = req.body.phone ? normalizeIndianPhone(req.body.phone) : '';
    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true });
    return sendSuccess(res, 'Profile updated', { user });
  })
);

const payments = express.Router();
payments.use(protect);
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
