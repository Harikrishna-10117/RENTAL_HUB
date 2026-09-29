const crypto = require('crypto');
const { AppError } = require('../utils/api');

function isRazorpayEnabled() {
  return (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase() === 'razorpay';
}

function credentials() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new AppError('Razorpay is selected but server credentials are not configured', 503, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  }
  return { keyId: RAZORPAY_KEY_ID, secret: RAZORPAY_KEY_SECRET };
}

function secureEqualHex(expected, received) {
  if (!/^[a-f0-9]{64}$/i.test(received || '')) return false;
  const expectedBytes = Buffer.from(expected, 'hex');
  const receivedBytes = Buffer.from(received, 'hex');
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const { secret } = credentials();
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return secureEqualHex(expected, signature);
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError('Razorpay webhook secret is not configured', 503, 'WEBHOOK_NOT_CONFIGURED');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return secureEqualHex(expected, signature);
}

async function request(path, { method = 'GET', body } = {}) {
  const { keyId, secret } = credentials();
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new AppError(`Payment provider request failed: ${error.message}`, 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new AppError('Payment provider returned an invalid response', 502, 'PAYMENT_PROVIDER_INVALID_RESPONSE');
  }
  if (!response.ok) {
    throw new AppError('Payment provider rejected the request', 502, 'PAYMENT_PROVIDER_REJECTED');
  }
  return result;
}

async function createOrRecoverOrder({ amountMinor, currency, receipt, notes }) {
  const query = new URLSearchParams({ receipt, count: '100' });
  const existing = await request(`/orders?${query.toString()}`);
  const matchingOrder = existing.items?.find((order) => order.receipt === receipt);
  if (matchingOrder) {
    if (matchingOrder.amount !== amountMinor || matchingOrder.currency !== currency) {
      throw new AppError('Existing payment order does not match the current booking amount', 409, 'PAYMENT_ORDER_MISMATCH');
    }
    return matchingOrder;
  }
  const order = await request('/orders', {
    method: 'POST',
    body: { amount: amountMinor, currency, receipt, notes }
  });
  if (!order.id || order.amount !== amountMinor || order.currency !== currency || order.receipt !== receipt) {
    throw new AppError('Payment provider returned an order that does not match the request', 502, 'PAYMENT_ORDER_MISMATCH');
  }
  return order;
}

async function fetchPayment(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}`);
}

async function createOrRecoverRefund({ paymentId, amountMinor, receipt, notes }) {
  const query = new URLSearchParams({ count: '100' });
  const existing = await request(`/payments/${encodeURIComponent(paymentId)}/refunds?${query.toString()}`);
  const matchingRefund = existing.items?.find((refund) => refund.receipt === receipt);
  if (matchingRefund) {
    if (matchingRefund.amount !== amountMinor) {
      throw new AppError('Existing refund does not match the refund amount', 409, 'REFUND_AMOUNT_MISMATCH');
    }
    return matchingRefund;
  }
  const refund = await request(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    body: { amount: amountMinor, receipt, notes, speed: 'normal' }
  });
  if (!refund.id || refund.amount !== amountMinor || refund.payment_id !== paymentId || refund.receipt !== receipt) {
    throw new AppError('Payment provider returned a refund that does not match the request', 502, 'REFUND_DETAILS_MISMATCH');
  }
  return refund;
}

module.exports = {
  isRazorpayEnabled,
  credentials,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  createOrRecoverOrder,
  fetchPayment,
  createOrRecoverRefund
};
