const LedgerEntry = require('../models/LedgerEntry');

function toMinorUnits(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new TypeError('Ledger amounts must be positive finite currency values');
  }
  const minor = Math.round((numericAmount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(minor) || minor < 1) {
    throw new TypeError('Ledger amount exceeds supported currency precision');
  }
  return minor;
}

async function postLedgerEntry(entry) {
  const normalized = {
    ...entry,
    amountMinor: entry.amountMinor ?? toMinorUnits(entry.amount),
    currency: (entry.currency || 'INR').toUpperCase()
  };
  delete normalized.amount;

  try {
    return await LedgerEntry.create(normalized);
  } catch (error) {
    if (error.code !== 11000 ||
      !(error.keyPattern?.idempotencyKey || error.keyValue?.idempotencyKey)) throw error;
    const existing = await LedgerEntry.findOne({ idempotencyKey: normalized.idempotencyKey });
    if (!existing) throw error;
    const matches = ['debitAccount', 'creditAccount', 'amountMinor', 'currency', 'sourceType', 'sourceId']
      .every((field) => String(existing[field]) === String(normalized[field]));
    if (!matches) {
      const conflict = new Error('Ledger idempotency key was reused with different posting details');
      conflict.code = 'LEDGER_IDEMPOTENCY_CONFLICT';
      throw conflict;
    }
    return existing;
  }
}

async function postBookingPayment(payment, booking) {
  const common = {
    sourceType: 'booking_payment',
    sourceId: String(payment._id),
    currency: payment.currency || booking.currency || 'INR',
    metadata: { bookingId: String(booking._id), paymentId: String(payment._id) }
  };
  const posts = [];
  if (booking.subtotal > 0) posts.push(postLedgerEntry({
    ...common,
    idempotencyKey: `payment:${payment._id}:rental`,
    debitAccount: 'payment_clearing',
    creditAccount: 'rental_payable',
    amount: booking.subtotal
  }));
  if (booking.depositAmount > 0) posts.push(postLedgerEntry({
    ...common,
    idempotencyKey: `payment:${payment._id}:deposit`,
    debitAccount: 'payment_clearing',
    creditAccount: 'deposit_liability',
    amount: booking.depositAmount
  }));
  return Promise.all(posts);
}

async function postDepositDisposition(deposit) {
  const common = {
    sourceType: 'deposit_disposition',
    sourceId: String(deposit._id),
    currency: deposit.currency || 'INR',
    metadata: { bookingId: String(deposit.booking), depositId: String(deposit._id) }
  };
  const posts = [];
  if (deposit.refundAmount > 0) posts.push(postLedgerEntry({
    ...common,
    idempotencyKey: `deposit:${deposit._id}:refund`,
    debitAccount: 'deposit_liability',
    creditAccount: 'payment_clearing',
    amount: deposit.refundAmount
  }));
  if (deposit.deductionAmount > 0) posts.push(postLedgerEntry({
    ...common,
    idempotencyKey: `deposit:${deposit._id}:deduction`,
    debitAccount: 'deposit_liability',
    creditAccount: 'damage_recovery_payable',
    amount: deposit.deductionAmount
  }));
  return Promise.all(posts);
}

async function postBookingCancellationRefund(payment, booking) {
  if (booking.subtotal <= 0) return null;
  return postLedgerEntry({
    idempotencyKey: `payment:${payment._id}:cancellation-rental`,
    debitAccount: 'rental_payable',
    creditAccount: 'payment_clearing',
    amount: booking.subtotal,
    currency: payment.currency || booking.currency || 'INR',
    sourceType: 'booking_cancellation',
    sourceId: String(booking._id),
    metadata: { bookingId: String(booking._id), paymentId: String(payment._id) }
  });
}

module.exports = { postLedgerEntry, postBookingPayment, postDepositDisposition, postBookingCancellationRefund, toMinorUnits };
