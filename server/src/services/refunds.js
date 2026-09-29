const crypto = require('node:crypto');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { AppError } = require('../utils/api');
const { toMinorUnits } = require('./ledger');
const { createOrRecoverRefund } = require('./razorpay');

function refundReceipt(idempotencyKey) {
  return `rh_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

async function issueRefund({ payment, booking, amount, idempotencyKey, reason }) {
  const amountMinor = toMinorUnits(amount);
  if (amountMinor > toMinorUnits(payment.amount)) {
    throw new AppError('Refund exceeds the captured payment amount', 409, 'REFUND_EXCEEDS_PAYMENT');
  }
  if (payment.method === 'razorpay' && amountMinor < 100) {
    throw new AppError('Razorpay refunds require a minimum of INR 1.00', 409, 'REFUND_AMOUNT_TOO_SMALL');
  }
  const receipt = refundReceipt(idempotencyKey);
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  let refund = await Refund.findOne({ idempotencyKey });

  if (refund && (refund.amountMinor !== amountMinor || String(refund.payment) !== String(payment._id))) {
    throw new AppError('Refund idempotency key was reused with different details', 409, 'REFUND_IDEMPOTENCY_CONFLICT');
  }
  if (refund?.status === 'succeeded') return refund;
  if (refund?.status === 'failed') {
    throw new AppError('This refund attempt failed and needs operator review', 409, 'REFUND_FAILED');
  }
  if (!refund) {
    const reserved = await Refund.aggregate([
      { $match: { payment: payment._id, status: { $in: ['pending', 'succeeded'] } } },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } }
    ]);
    if ((reserved[0]?.totalMinor || 0) + amountMinor > toMinorUnits(payment.amount)) {
      throw new AppError('Total refunds exceed the captured payment amount', 409, 'REFUND_EXCEEDS_PAYMENT');
    }
    try {
      refund = await Refund.create({
        booking: booking._id,
        payment: payment._id,
        idempotencyKey,
        receipt,
        amountMinor,
        currency: payment.currency || booking.currency || 'INR',
        provider: payment.method === 'razorpay' ? 'razorpay' : 'mock',
        status: 'pending',
        reason,
        leaseToken,
        leaseUntil: new Date(now.getTime() + 30_000)
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      refund = await Refund.findOne({ idempotencyKey });
      if (!refund) throw error;
    }
  }

  if (refund.status === 'succeeded') return refund;
  if (refund.amountMinor !== amountMinor || String(refund.payment) !== String(payment._id)) {
    throw new AppError('Refund idempotency key was reused with different details', 409, 'REFUND_IDEMPOTENCY_CONFLICT');
  }
  if (refund.leaseUntil > now && refund.leaseToken !== leaseToken) {
    throw new AppError('Refund is being processed; retry with the same idempotency key', 503, 'REFUND_IN_PROGRESS');
  }
  if (refund.leaseToken !== leaseToken) {
    const claimed = await Refund.findOneAndUpdate(
      { _id: refund._id, status: 'pending', leaseUntil: { $lte: now } },
      { $set: { leaseToken, leaseUntil: new Date(now.getTime() + 30_000) } },
      { new: true }
    );
    if (!claimed) throw new AppError('Refund is being processed; retry with the same idempotency key', 503, 'REFUND_IN_PROGRESS');
    refund = claimed;
  }

  try {
    let providerRefundId;
    let status = 'succeeded';
    if (refund.provider === 'razorpay') {
      if (!payment.providerPaymentId) {
        throw new AppError('Captured Razorpay payment reference is missing for refund', 409, 'PAYMENT_REFERENCE_MISSING');
      }
      const result = await createOrRecoverRefund({
        paymentId: payment.providerPaymentId,
        amountMinor,
        receipt,
        notes: { bookingId: String(booking._id), reason }
      });
      providerRefundId = result.id;
      status = result.status === 'processed' ? 'succeeded' :
        result.status === 'failed' ? 'failed' : 'pending';
    } else {
      providerRefundId = `mock_${receipt}`;
    }
    refund.status = status;
    refund.providerRefundId = providerRefundId;
    refund.leaseToken = undefined;
    refund.leaseUntil = new Date();
    await refund.save();
    if (status === 'failed') throw new AppError('Payment provider rejected the refund', 502, 'REFUND_FAILED');
    if (status === 'succeeded') await updatePaymentRefundStatus(payment);
    return refund;
  } catch (error) {
    await Refund.updateOne(
      { _id: refund._id, status: 'pending' },
      { $set: { leaseUntil: new Date() }, $unset: { leaseToken: 1 } }
    );
    throw error;
  }
}

async function updatePaymentRefundStatus(payment) {
  const refunds = await Refund.aggregate([
    { $match: { payment: payment._id, status: 'succeeded' } },
    { $group: { _id: null, totalMinor: { $sum: '$amountMinor' } } }
  ]);
  if ((refunds[0]?.totalMinor || 0) >= toMinorUnits(payment.amount)) {
    await Payment.updateOne({ _id: payment._id, status: 'succeeded' }, { $set: { status: 'refunded' } });
  }
}

module.exports = { issueRefund, updatePaymentRefundStatus, refundReceipt };
