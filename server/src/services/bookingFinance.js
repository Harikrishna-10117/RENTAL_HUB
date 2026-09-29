const Payment = require('../models/Payment');
const Deposit = require('../models/Deposit');
const Refund = require('../models/Refund');
const Booking = require('../models/Booking');
const { postBookingCancellationRefund, postDepositDisposition, postLedgerEntry } = require('./ledger');
const { issueRefund, updatePaymentRefundStatus } = require('./refunds');
const { AppError } = require('../utils/api');
const notify = require('../utils/notifications');

async function settleBookingCancellation(booking) {
  let rentalRefundPending = false;
  const payment = await Payment.findOne({ booking: booking._id, status: { $in: ['succeeded', 'refunded'] } })
    .sort({ createdAt: 1 });
  if (payment) {
    if (booking.subtotal > 0) {
      const refund = await issueRefund({
        payment,
        booking,
        amount: booking.subtotal,
        idempotencyKey: `booking:${booking._id}:cancellation-rental`,
        reason: 'booking_cancellation_rental'
      });
      if (refund.status === 'succeeded') await postBookingCancellationRefund(payment, booking);
      else rentalRefundPending = true;
    }
  }

  let deposit = await Deposit.findOne({ booking: booking._id });
  if (deposit?.status === 'held') {
    deposit.status = deposit.amount > 0 ? 'refund_pending' : 'forfeited';
    deposit.refundAmount = deposit.amount;
    deposit.deductionAmount = 0;
    await deposit.save();
  }
  let depositRefundPending = false;
  if (deposit && ['refund_pending', 'refund_failed', 'refunded', 'partially_refunded', 'forfeited'].includes(deposit.status)) {
    const disposition = await settleDepositDisposition(deposit);
    depositRefundPending = Boolean(disposition.refund);
  }
  return { refundPending: rentalRefundPending || depositRefundPending };
}

async function settleDepositDisposition(deposit) {
  if (deposit.status === 'refund_failed') {
    throw new AppError('Deposit refund failed and needs operator review', 409, 'REFUND_FAILED');
  }
  if (deposit.refundAmount > 0) {
    const payment = await Payment.findOne({
      booking: deposit.booking,
      status: { $in: ['succeeded', 'refunded'] }
    }).sort({ createdAt: 1 });
    if (!payment) throw new AppError('Successful payment record for the deposit was not found', 409, 'PAYMENT_NOT_FOUND');
    const refund = await issueRefund({
      payment,
      booking: { _id: deposit.booking, currency: deposit.currency },
      amount: deposit.refundAmount,
      idempotencyKey: `deposit:${deposit._id}:refund`,
      reason: 'deposit_refund'
    });
    if (refund.status !== 'succeeded') {
      deposit.status = 'refund_pending';
      await deposit.save();
      return { deposit, refund };
    }
  }
  await postDepositDisposition(deposit);
  deposit.status = deposit.deductionAmount === 0
    ? 'refunded'
    : deposit.refundAmount === 0
      ? 'forfeited'
      : 'partially_refunded';
  await deposit.save();
  await Booking.updateOne({ _id: deposit.booking }, { $set: { depositRefunded: true } });
  return { deposit, refund: null };
}

async function resolveProviderRefund(providerRefundId, providerStatus, providerDetails = {}) {
  const refund = await Refund.findOne({ providerRefundId });
  if (!refund) throw new AppError('Provider refund record was not found', 503, 'REFUND_NOT_FOUND');
  const payment = await Payment.findById(refund.payment);
  if (!payment) throw new AppError('Payment for provider refund was not found', 503, 'PAYMENT_NOT_FOUND');
  if ((providerDetails.amount !== undefined && providerDetails.amount !== refund.amountMinor) ||
    (providerDetails.currency && providerDetails.currency !== refund.currency) ||
    (providerDetails.paymentId && providerDetails.paymentId !== payment.providerPaymentId)) {
    throw new AppError('Provider refund details do not match the stored refund', 409, 'REFUND_DETAILS_MISMATCH');
  }
  if (providerStatus === 'processed' && refund.status !== 'succeeded') {
    refund.status = 'succeeded';
    refund.leaseToken = undefined;
    refund.leaseUntil = new Date();
    await refund.save();
  }
  if (providerStatus === 'processed' || refund.status === 'succeeded') {
    await updatePaymentRefundStatus(payment);
    if (refund.reason === 'booking_cancellation_rental') {
      const booking = await Booking.findById(refund.booking);
      if (!booking) throw new AppError('Booking for provider refund was not found', 503, 'BOOKING_NOT_FOUND');
      await postBookingCancellationRefund(payment, booking);
    } else if (refund.reason === 'deposit_refund') {
      const deposit = await Deposit.findOne({ booking: refund.booking });
      if (!deposit) throw new AppError('Deposit for provider refund was not found', 503, 'DEPOSIT_NOT_FOUND');
      if (deposit.status === 'refund_failed') {
        deposit.status = 'refund_pending';
        await deposit.save();
      }
      const disposition = await settleDepositDisposition(deposit);
      if (disposition.deposit.status !== 'refund_pending') {
        await notify(deposit.customer, 'deposit_processed', 'Deposit refund complete',
          `Your deposit refund of ${deposit.refundAmount} has been processed.`, { bookingId: String(deposit.booking) });
      }
    } else if (refund.reason === 'duplicate_payment') {
      await postLedgerEntry({
        idempotencyKey: `payment:${payment._id}:unapplied-refund`,
        debitAccount: 'customer_overpayment_liability',
        creditAccount: 'payment_clearing',
        amount: refund.amountMinor / 100,
        currency: refund.currency,
        sourceType: 'unapplied_payment_refund',
        sourceId: String(refund.booking),
        metadata: { bookingId: String(refund.booking), paymentId: String(payment._id) }
      });
      await notify(payment.customer, 'payment_refunded', 'Duplicate payment refunded',
        'A duplicate payment was received for a booking and has been refunded.', { bookingId: String(refund.booking) });
    }
    if (refund.reason === 'booking_cancellation_rental') {
      const booking = await Booking.findById(refund.booking);
      if (booking) {
        await notify(booking.customer, 'booking_refund_processed', 'Booking refund complete',
          `Your booking rental refund of ${refund.amountMinor / 100} has been processed.`, { bookingId: booking.id });
      }
    }
  } else if (providerStatus === 'failed') {
    refund.status = 'failed';
    refund.leaseToken = undefined;
    refund.leaseUntil = new Date();
    await refund.save();
    if (refund.reason === 'deposit_refund') {
      await Deposit.updateOne({ booking: refund.booking }, { $set: { status: 'refund_failed' } });
    }
  }
  return refund;
}

module.exports = { settleBookingCancellation, settleDepositDisposition, resolveProviderRefund };
