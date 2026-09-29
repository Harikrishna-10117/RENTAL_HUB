const Booking = require('../models/Booking');
const Deposit = require('../models/Deposit');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const EquipmentEvent = require('../models/EquipmentEvent');
const { AppError } = require('../utils/api');
const { postBookingPayment, postLedgerEntry } = require('./ledger');
const { settleBookingCancellation } = require('./bookingFinance');
const { issueRefund } = require('./refunds');
const notify = require('../utils/notifications');
const { toMinorUnits } = require('./ledger');

async function refundUnappliedPayment(payment, booking, providerPaymentId) {
  if (payment.status !== 'succeeded') {
    payment.status = 'succeeded';
    payment.providerPaymentId = providerPaymentId;
    await payment.save();
  }
  await postLedgerEntry({
    idempotencyKey: `payment:${payment._id}:unapplied-capture`,
    debitAccount: 'payment_clearing',
    creditAccount: 'customer_overpayment_liability',
    amount: payment.amount,
    currency: payment.currency || booking.currency || 'INR',
    sourceType: 'unapplied_booking_payment',
    sourceId: String(booking._id),
    metadata: { bookingId: String(booking._id), paymentId: String(payment._id) }
  });
  const refund = await issueRefund({
    payment,
    booking,
    amount: payment.amount,
    idempotencyKey: `booking:${booking._id}:unapplied-payment:${payment._id}`,
    reason: 'duplicate_payment'
  });
  if (refund.status === 'succeeded') {
    await postLedgerEntry({
      idempotencyKey: `payment:${payment._id}:unapplied-refund`,
      debitAccount: 'customer_overpayment_liability',
      creditAccount: 'payment_clearing',
      amount: payment.amount,
      currency: payment.currency || booking.currency || 'INR',
      sourceType: 'unapplied_payment_refund',
      sourceId: String(booking._id),
      metadata: { bookingId: String(booking._id), paymentId: String(payment._id) }
    });
  }
  return { booking, payment, refunded: refund.status === 'succeeded', refundPending: refund.status !== 'succeeded' };
}

async function settleCapturedCancelledBooking(payment, booking) {
  await postBookingPayment(payment, booking);
  await Deposit.findOneAndUpdate(
    { booking: booking._id },
    { $setOnInsert: {
      customer: booking.customer,
      amount: booking.depositAmount,
      currency: booking.currency || 'INR'
    } },
    { new: true, upsert: true, runValidators: true }
  );
  const settlement = await settleBookingCancellation(booking);
  const cancelledBooking = await Booking.findById(booking._id);
  return {
    booking: cancelledBooking,
    payment,
    refunded: !settlement.refundPending,
    refundPending: settlement.refundPending
  };
}

async function finalizeCapturedPayment(payment, providerPaymentId) {
  const booking = await Booking.findById(payment.booking);
  if (!booking) throw new AppError('Booking for payment was not found', 404, 'BOOKING_NOT_FOUND');
  const awaitingPayment = ['pending_payment', 'payment_processing', 'approved'].includes(booking.status);
  if (payment.providerOrderId && payment.providerOrderId !== payment.transactionId) {
    throw new AppError('Stored payment order reference is inconsistent', 409, 'PAYMENT_ORDER_MISMATCH');
  }
  if (payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId) {
    throw new AppError('A different provider payment is already attached to this order', 409, 'PAYMENT_REFERENCE_MISMATCH');
  }
  if (payment.status === 'failed') {
    throw new AppError('This payment attempt is no longer eligible for confirmation', 409, 'INVALID_PAYMENT_STATE');
  }
  if (payment.status === 'refunded') {
    if (booking.status === 'cancelled') await settleBookingCancellation(booking);
    const duplicateRefund = await Refund.findOne({
      payment: payment._id,
      reason: 'duplicate_payment',
      status: 'succeeded'
    });
    if (duplicateRefund) return refundUnappliedPayment(payment, booking, providerPaymentId);
    return { booking, payment, refunded: booking.status === 'cancelled' };
  }

  if (!awaitingPayment && booking.status !== 'cancelled') {
    if (String(booking.payment) === String(payment._id)) {
      await postBookingPayment(payment, booking);
      return { booking, payment };
    }
    return refundUnappliedPayment(payment, booking, providerPaymentId);
  }

  if (toMinorUnits(payment.amount) !== toMinorUnits(booking.totalAmount)) {
    throw new AppError('Captured payment amount does not match the booking total', 409, 'PAYMENT_AMOUNT_MISMATCH');
  }
  if (payment.status !== 'succeeded') {
    payment.status = 'succeeded';
    payment.providerPaymentId = providerPaymentId;
    await payment.save();
  }

  if (booking.status === 'cancelled' || (awaitingPayment && (!booking.paymentExpiresAt || booking.paymentExpiresAt <= new Date()))) {
    if (booking.status !== 'cancelled') {
      booking.status = 'cancelled';
      await booking.save();
    }
    return settleCapturedCancelledBooking(payment, booking);
  }
  if (!awaitingPayment) {
    throw new AppError('Booking is not awaiting payment confirmation', 409, 'INVALID_BOOKING_STATE');
  }
  const confirmed = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ['pending_payment', 'payment_processing', 'approved'] } },
    { $set: { status: 'confirmed', payment: payment._id } },
    { new: true }
  );
  if (!confirmed) {
    const current = await Booking.findById(booking._id);
    if (current?.status === 'confirmed' && String(current.payment) === String(payment._id)) {
      await postBookingPayment(payment, booking);
      return { booking: current, payment };
    }
    if (current?.status === 'confirmed') {
      return refundUnappliedPayment(payment, current, providerPaymentId);
    }
    if (current?.status === 'cancelled') {
      return settleCapturedCancelledBooking(payment, current);
    }
    throw new AppError('Booking changed while payment was being confirmed', 409, 'INVALID_BOOKING_STATE');
  }
  await postBookingPayment(payment, booking);
  await Deposit.findOneAndUpdate(
    { booking: booking._id },
    { $setOnInsert: {
      customer: booking.customer,
      amount: booking.depositAmount,
      currency: booking.currency || 'INR'
    } },
    { new: true, upsert: true, runValidators: true }
  );
  await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
    equipment,
    booking: booking._id,
    actor: booking.customer,
    type: 'booking_confirmed',
    details: { payment: payment._id, provider: payment.method }
  })), { ordered: false });
  await notify(booking.owner, 'booking_confirmed', 'Booking confirmed', 'Your booking payment has been confirmed.', { bookingId: booking.id });
  return { booking: confirmed, payment };
}

module.exports = { finalizeCapturedPayment };
