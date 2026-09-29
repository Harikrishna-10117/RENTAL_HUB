const express = require('express');
const crypto = require('node:crypto');
const Payment = require('../models/Payment');
const WebhookEvent = require('../models/WebhookEvent');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { isRazorpayEnabled, verifyWebhookSignature } = require('../services/razorpay');
const { finalizeCapturedPayment } = require('../services/paymentLifecycle');
const { toMinorUnits } = require('../services/ledger');
const { resolveProviderRefund } = require('../services/bookingFinance');

const router = express.Router();
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(async (req, res) => {
  if (!isRazorpayEnabled()) throw new AppError('Razorpay webhook is not enabled', 404, 'NOT_FOUND');
  if (!Buffer.isBuffer(req.body)) throw new AppError('Webhook body must be raw JSON bytes', 400, 'INVALID_WEBHOOK_BODY');
  const signature = req.get('x-razorpay-signature') || '';
  if (!verifyWebhookSignature(req.body, signature)) {
    throw new AppError('Webhook signature is invalid', 400, 'INVALID_WEBHOOK_SIGNATURE');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    throw new AppError('Webhook body contains invalid JSON', 400, 'INVALID_WEBHOOK_BODY');
  }
  const eventType = payload.event;
  if (typeof eventType !== 'string' || eventType.length > 100) {
    throw new AppError('Webhook event type is invalid', 400, 'INVALID_WEBHOOK_BODY');
  }
  const eventId = req.get('x-razorpay-event-id') ||
    crypto.createHash('sha256').update(req.body).digest('hex');
  const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
  let event;
  try {
    event = await WebhookEvent.create({
      eventId,
      eventType,
      payloadHash,
      status: 'processing',
      leaseUntil: new Date(Date.now() + 60_000)
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await WebhookEvent.findOne({ eventId });
    if (!existing) throw error;
    if (existing.payloadHash !== payloadHash) {
      throw new AppError('Webhook event ID was reused with different content', 409, 'WEBHOOK_ID_CONFLICT');
    }
    if (existing.status === 'processed') return sendSuccess(res, 'Webhook event already processed', { eventId });
    event = await WebhookEvent.findOneAndUpdate(
      { _id: existing._id, status: 'processing', leaseUntil: { $lte: new Date() } },
      { $set: { leaseUntil: new Date(Date.now() + 60_000) } },
      { new: true }
    );
    if (!event) throw new AppError('Webhook event is already being processed', 503, 'WEBHOOK_IN_PROGRESS');
  }

  try {
    if (['payment.captured', 'order.paid'].includes(eventType)) {
      const providerPayment = payload.payload?.payment?.entity;
      if (!providerPayment?.order_id || !providerPayment.id) {
        throw new AppError('Captured payment event is missing payment details', 400, 'INVALID_WEBHOOK_BODY');
      }
      const payment = await Payment.findOne({ providerOrderId: providerPayment.order_id, method: 'razorpay' });
      if (!payment) throw new AppError('Checkout order is not registered', 503, 'PAYMENT_ORDER_NOT_FOUND');
      if (providerPayment.amount !== toMinorUnits(payment.amount) ||
        providerPayment.currency !== (payment.currency || 'INR')) {
        throw new AppError('Captured payment does not match the order amount', 409, 'PAYMENT_DETAILS_MISMATCH');
      }
      await finalizeCapturedPayment(payment, providerPayment.id);
    } else if (eventType === 'payment.failed') {
      const providerPayment = payload.payload?.payment?.entity;
      if (!providerPayment?.order_id) throw new AppError('Failed payment event is missing its order ID', 400, 'INVALID_WEBHOOK_BODY');
      const payment = await Payment.findOne({ providerOrderId: providerPayment.order_id, method: 'razorpay' });
      if (!payment) throw new AppError('Checkout order is not registered', 503, 'PAYMENT_ORDER_NOT_FOUND');
      if (payment.status === 'pending') {
        payment.status = 'failed';
        payment.providerPaymentId = providerPayment.id;
        await payment.save();
      }
    } else if (['refund.processed', 'refund.failed'].includes(eventType)) {
      const providerRefund = payload.payload?.refund?.entity;
      if (!providerRefund?.id) throw new AppError('Refund event is missing its refund ID', 400, 'INVALID_WEBHOOK_BODY');
      await resolveProviderRefund(
        providerRefund.id,
        eventType === 'refund.processed' ? 'processed' : 'failed',
        {
          amount: providerRefund.amount,
          currency: providerRefund.currency,
          paymentId: providerRefund.payment_id
        }
      );
    }
    event.status = 'processed';
    event.processedAt = new Date();
    event.leaseUntil = new Date();
    await event.save();
    return sendSuccess(res, 'Webhook event processed', { eventId });
  } catch (error) {
    await WebhookEvent.updateOne(
      { _id: event._id, status: 'processing' },
      { $set: { leaseUntil: new Date() } }
    );
    throw error;
  }
}));

module.exports = router;
