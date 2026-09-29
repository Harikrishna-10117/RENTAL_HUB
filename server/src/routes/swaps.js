const express = require('express');
const SwapRequest = require('../models/SwapRequest');
const Equipment = require('../models/Equipment');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Deposit = require('../models/Deposit');
const EquipmentEvent = require('../models/EquipmentEvent');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../utils/validation');
const idempotency = require('../middleware/idempotency');
const notify = require('../utils/notifications');
const { assertAvailable, withReservationLocks } = require('../services/availability');
const { setAssetsLifecycle } = require('../services/inventory');
const { postLedgerEntry } = require('../services/ledger');
const { isRazorpayEnabled } = require('../services/razorpay');

const router = express.Router();
router.use(protect);
router.use((req, res, next) => (
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? idempotency(req, res, next) : next()
));

router.post('/',
  body('requestedEquipment').optional().isMongoId(),
  body('swapType').optional().isIn(['item_for_item', 'item_plus_cash', 'cash_for_item']),
  body('offeredEquipment').optional().isMongoId(),
  body('message').optional().isString().isLength({ max: 1000 }),
  body('bookingId').optional().isMongoId(),
  body('type').optional().isIn(['UPGRADE', 'DOWNGRADE', 'FAILURE_REPLACEMENT']),
  body('description').optional().isString().isLength({ max: 1000 }),
  validate,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'customer') throw new AppError('Only customers can request swaps', 403, 'FORBIDDEN');
    if (req.body.bookingId) {
      const booking = await Booking.findOne({
        _id: req.body.bookingId, customer: req.user.id, status: 'in_progress'
      }).populate('equipment');
      if (!booking) throw new AppError('Only your active booking can be swapped', 404, 'NOT_FOUND');
      if (booking.equipment.length !== 1) throw new AppError('Equipment swaps are available for single-item bookings only', 409, 'UNSUPPORTED_BOOKING');
      const current = booking.equipment[0];
      if (!current) throw new AppError('Booking has no equipment to swap', 400, 'INVALID_BOOKING');
      const type = req.body.type || 'FAILURE_REPLACEMENT';
      const dailyRateMatch = type === 'UPGRADE' ? { $gt: current.dailyRate } :
        type === 'DOWNGRADE' ? { $lt: current.dailyRate } : { $gte: current.dailyRate * 0.8 };
      const candidates = await Equipment.find({
        owner: booking.owner,
        active: true,
        status: 'available',
        category: current.category,
        _id: { $nin: booking.equipment.map((item) => item._id) },
        dailyRate: dailyRateMatch,
        ...(type === 'FAILURE_REPLACEMENT' ? { replacementValue: { $gte: current.replacementValue * 0.8 } } : {})
      }).sort({ dailyRate: type === 'DOWNGRADE' ? -1 : 1 }).limit(10);
      const remainingDays = Math.max(1, Math.ceil((booking.endDate - Math.max(Date.now(), booking.startDate.getTime())) / 86400000));
      let requested;
      for (const candidate of candidates) {
        try {
          await assertAvailable([candidate._id], booking.startDate, booking.endDate);
          requested = candidate;
          break;
        } catch (error) {
          if (error.errorCode !== 'DATES_UNAVAILABLE') throw error;
        }
      }
      if (!requested) throw new AppError('The owner has no available comparable item for the rest of this rental', 409, 'NO_SWAP_CANDIDATE');
      const rentalDifference = type === 'FAILURE_REPLACEMENT'
        ? 0
        : Math.round((requested.dailyRate - current.dailyRate) * remainingDays * 100) / 100;
      const requestedDepositDifference = Math.round((requested.depositAmount - current.depositAmount) * 100) / 100;
      const depositDifference = type === 'FAILURE_REPLACEMENT'
        ? Math.min(0, requestedDepositDifference)
        : requestedDepositDifference;
      const swapType = type === 'UPGRADE' ? 'item_plus_cash' : type === 'DOWNGRADE' ? 'cash_for_item' : 'item_for_item';
      const swap = await SwapRequest.create({
        requester: req.user.id,
        recipient: booking.owner,
        booking: booking._id,
        offeredEquipment: current._id,
        requestedEquipment: requested._id,
        swapType,
        cashDifference: Math.max(0, rentalDifference),
        rentalType: type,
        remainingRentalDays: remainingDays,
        rentalDifference,
        depositDifference,
        message: req.body.description || ''
      });
      await notify(booking.owner, 'swap_request', 'New swap request', req.body.description || 'A renter requested an equipment change.', { swapRequestId: swap.id, bookingId: booking.id });
      return sendSuccess(res, 'Swap request created', swap, 201);
    }
    if (!req.body.requestedEquipment || !req.body.swapType) {
      throw new AppError('Provide bookingId/type or requestedEquipment/swapType', 400, 'VALIDATION_ERROR');
    }
    const target = await Equipment.findOne({ _id: req.body.requestedEquipment, active: true, status: 'available' });
    if (!target) throw new AppError('Requested equipment not found', 404, 'NOT_FOUND');
    if (target.owner.toString() === req.user.id) throw new AppError('You cannot request your own equipment', 400, 'INVALID_SWAP');
    let offered = null;
    if (req.body.swapType === 'cash_for_item') {
      if (req.body.offeredEquipment) throw new AppError('cash_for_item must not include offered equipment', 400, 'INVALID_SWAP');
    } else {
      if (!req.body.offeredEquipment) throw new AppError('offeredEquipment is required for this swap type', 400, 'INVALID_SWAP');
      offered = await Equipment.findOne({
        _id: req.body.offeredEquipment, owner: req.user.id, active: true, status: 'available'
      });
      if (!offered) throw new AppError('You may only offer equipment that you own and have listed', 404, 'OFFER_NOT_FOUND');
    }

    const priceDifference = offered ? Math.max(0, target.replacementValue - offered.replacementValue) : target.replacementValue;
    if (req.body.swapType === 'item_for_item' &&
      Math.abs(target.replacementValue - offered.replacementValue) > Math.max(25, target.replacementValue * 0.1)) {
      throw new AppError('Item values are not close enough for item_for_item; use item_plus_cash or cash_for_item', 400, 'VALUE_MISMATCH');
    }
    const swap = await SwapRequest.create({
      requester: req.user.id,
      recipient: target.owner,
      ...(offered ? { offeredEquipment: offered._id } : {}),
      requestedEquipment: target._id,
      swapType: req.body.swapType,
      cashDifference: req.body.swapType === 'item_for_item' ? 0 : priceDifference,
      message: req.body.message || ''
    });
    await notify(target.owner, 'swap_request', 'New swap request', 'A renter proposed an equipment swap.', { swapRequestId: swap.id });
    return sendSuccess(res, 'Swap request created', swap, 201);
  })
);

router.get('/mine', asyncHandler(async (req, res) => {
  if (req.user.role !== 'customer') throw new AppError('Only customers can view their swaps', 403, 'FORBIDDEN');
  const [sent, received] = await Promise.all([
    SwapRequest.find({ requester: req.user.id }).populate('offeredEquipment requestedEquipment recipient', 'name dailyRate replacementValue name email').sort({ createdAt: -1 }),
    SwapRequest.find({ recipient: req.user.id }).populate('offeredEquipment requestedEquipment requester', 'name dailyRate replacementValue name email').sort({ createdAt: -1 })
  ]);
  return sendSuccess(res, 'Your swap requests', { sent, received });
}));

router.get('/my', asyncHandler(async (req, res) => {
  if (req.user.role !== 'customer') throw new AppError('Only customers can view their swaps', 403, 'FORBIDDEN');
  const swaps = await SwapRequest.find({ requester: req.user.id })
    .populate({ path: 'booking', select: 'startDate endDate status totalAmount customer', populate: { path: 'equipment', select: 'name images dailyRate' } })
    .populate('offeredEquipment requestedEquipment', 'name images dailyRate replacementValue')
    .sort({ createdAt: -1 });
  const presented = swaps.map((swap) => {
    const value = swap.toObject();
    value.type = swap.swapType === 'item_plus_cash' ? 'UPGRADE' :
      swap.swapType === 'cash_for_item' ? 'DOWNGRADE' : 'FAILURE_REPLACEMENT';
    value.description = swap.message;
    return value;
  });
  return sendSuccess(res, 'Your swap requests', presented);
}));

router.get('/owner', allowRoles('owner'), asyncHandler(async (req, res) => {
  const swaps = await SwapRequest.find({ recipient: req.user.id })
    .populate({ path: 'booking', select: 'startDate endDate status customer', populate: [{ path: 'equipment', select: 'name images dailyRate' }, { path: 'customer', select: 'name' }] })
    .populate('requester', 'name email')
    .populate('offeredEquipment requestedEquipment', 'name images dailyRate replacementValue')
    .sort({ createdAt: -1 });
  const presented = swaps.map((swap) => {
    const value = swap.toObject();
    value.type = swap.swapType === 'item_plus_cash' ? 'UPGRADE' :
      swap.swapType === 'cash_for_item' ? 'DOWNGRADE' : 'FAILURE_REPLACEMENT';
    value.description = swap.message;
    value.customer = value.requester;
    return value;
  });
  return sendSuccess(res, 'Swap requests for your equipment', presented);
}));

router.patch('/:id/respond',
  allowRoles('owner'),
  objectId(),
  body('decision').isIn(['accepted', 'rejected']),
  validate,
  asyncHandler(async (req, res) => {
    const swap = await SwapRequest.findOne({ _id: req.params.id, recipient: req.user.id });
    if (!swap) throw new AppError('Swap request not found', 404, 'NOT_FOUND');
    if (swap.status !== 'pending') throw new AppError('Only pending requests can be answered', 409, 'INVALID_STATE');
    swap.status = req.body.decision;
    await swap.save();
    await notify(swap.requester, `swap_${swap.status}`, `Swap ${swap.status}`, `Your swap request was ${swap.status}.`, { swapRequestId: swap.id });
    return sendSuccess(res, `Swap ${swap.status}`, swap);
  })
);

router.patch('/:id/status',
  allowRoles('owner'),
  objectId(),
  body('status').isIn(['accepted', 'approved', 'rejected']),
  validate,
  asyncHandler(async (req, res) => {
    const swap = await SwapRequest.findOne({ _id: req.params.id, recipient: req.user.id, status: 'pending' });
    if (!swap) throw new AppError('Pending swap request not found', 404, 'NOT_FOUND');
    if (req.body.status === 'rejected') {
      swap.status = 'rejected';
      await swap.save();
      await notify(swap.requester, 'swap_rejected', 'Swap rejected', 'Your swap request was rejected by the owner.', { swapRequestId: swap.id });
      return sendSuccess(res, 'Swap rejected', swap);
    }
    if (swap.booking) {
      await withReservationLocks([swap.requestedEquipment], async () => {
        const booking = await Booking.findOne({
          _id: swap.booking,
          customer: swap.requester,
          owner: req.user.id,
          status: 'in_progress',
          equipment: swap.offeredEquipment
        });
        if (!booking) throw new AppError('The rental is no longer eligible for this swap', 409, 'INVALID_STATE');
        const requested = await Equipment.findOne({
          _id: swap.requestedEquipment, owner: req.user.id, active: true, status: 'available'
        });
        if (!requested) throw new AppError('Replacement equipment is no longer available', 409, 'ITEM_UNAVAILABLE');
        await assertAvailable([requested._id], booking.startDate, booking.endDate);
        const deposit = await Deposit.findOne({ booking: booking._id, status: 'held' });
        if (!deposit) throw new AppError('The booking deposit is not held', 409, 'DEPOSIT_NOT_HELD');
        const rentalDifference = swap.rentalType === 'FAILURE_REPLACEMENT' ? 0 : swap.rentalDifference;
        const nextDepositAmount = deposit.amount + swap.depositDifference;
        if (nextDepositAmount < 0) throw new AppError('The adjusted deposit cannot be negative', 409, 'INVALID_DEPOSIT');
        const nextSubtotal = booking.subtotal + rentalDifference;
        if (nextSubtotal < 0) throw new AppError('The adjusted rental amount cannot be negative', 409, 'INVALID_AMOUNT');
        if (isRazorpayEnabled() && (rentalDifference !== 0 || swap.depositDifference !== 0)) {
          throw new AppError('This swap changes the rental or deposit amount; provider-backed swap checkout is not configured for this workflow', 409, 'SWAP_ADJUSTMENT_PROVIDER_UNAVAILABLE');
        }
        for (const [amount, suffix] of [
          [rentalDifference, 'rental'],
          [swap.depositDifference, 'deposit']
        ]) {
          if (amount === 0) continue;
          const direction = amount > 0 ? 'charge' : 'refund';
          const operationKey = `swap:${swap._id}:${suffix}:v1`;
          const record = await Payment.findOneAndUpdate(
            { operationKey },
            { $setOnInsert: {
            booking: booking._id,
            customer: swap.requester,
            amount: Math.abs(amount),
            currency: booking.currency || 'INR',
            status: direction === 'refund' ? 'refunded' : 'succeeded',
            method: 'mock',
            transactionId: `mock_swap_${swap._id}_${suffix}`,
            operationKey
            } },
            { new: true, upsert: true, runValidators: true }
          );
          if (record.amount !== Math.abs(amount)) {
            throw new AppError('Swap financial details changed after processing began', 409, 'IDEMPOTENCY_CONFLICT');
          }
          const directionAccounts = suffix === 'rental'
            ? direction === 'charge'
              ? ['payment_clearing', 'rental_payable']
              : ['rental_payable', 'payment_clearing']
            : direction === 'charge'
              ? ['payment_clearing', 'deposit_liability']
              : ['deposit_liability', 'payment_clearing'];
          await postLedgerEntry({
            idempotencyKey: operationKey,
            debitAccount: directionAccounts[0],
            creditAccount: directionAccounts[1],
            amount: record.amount,
            currency: record.currency,
            sourceType: 'rental_swap',
            sourceId: String(swap._id),
            metadata: { bookingId: String(booking._id), paymentId: String(record._id), component: suffix }
          });
        }
        const previousEquipment = booking.equipment[0];
        booking.equipment = [requested._id];
        booking.assets = requested.assetRef ? [requested.assetRef] : [];
        booking.requestedEquipment = [...new Set([...(booking.requestedEquipment || []), ...[previousEquipment]])];
        booking.subtotal = nextSubtotal;
        booking.depositAmount = nextDepositAmount;
        booking.totalAmount = nextSubtotal + nextDepositAmount;
        await booking.save();
        deposit.amount = nextDepositAmount;
        await deposit.save();
        await setAssetsLifecycle([previousEquipment], 'listed');
        await setAssetsLifecycle([requested._id], 'in_service');
        await EquipmentEvent.insertMany([
          { equipment: previousEquipment, booking: booking._id, actor: req.user.id, type: 'swap_equipment_returned', details: { swapRequestId: swap.id } },
          { equipment: requested._id, booking: booking._id, actor: req.user.id, type: 'swap_replacement_dispatched', details: { swapRequestId: swap.id, rentalType: swap.rentalType } }
        ]);
        swap.status = 'accepted';
        await swap.save();
      });
    } else {
      swap.status = 'accepted';
      await swap.save();
    }
    await notify(swap.requester, `swap_${swap.status}`, `Swap ${swap.status}`, `Your swap request was ${swap.status}.`, { swapRequestId: swap.id });
    return sendSuccess(res, `Swap ${swap.status}`, swap);
  })
);

router.post('/:id/cancel', allowRoles('customer'), objectId(), validate, asyncHandler(async (req, res) => {
  const swap = await SwapRequest.findOne({ _id: req.params.id, requester: req.user.id, status: 'pending' });
  if (!swap) throw new AppError('Pending swap request not found', 404, 'NOT_FOUND');
  swap.status = 'cancelled';
  await swap.save();
  return sendSuccess(res, 'Swap request cancelled', swap);
}));

module.exports = router;
