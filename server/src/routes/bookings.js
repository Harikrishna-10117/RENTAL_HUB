const express = require('express');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Rental = require('../models/Rental');
const ReservationHold = require('../models/ReservationHold');
const Equipment = require('../models/Equipment');
const Payment = require('../models/Payment');
const Deposit = require('../models/Deposit');
const Delivery = require('../models/Delivery');
const EquipmentEvent = require('../models/EquipmentEvent');
const Review = require('../models/Review');
const Package = require('../models/Package');
const { postBookingPayment } = require('../services/ledger');
const { settleBookingCancellation, settleDepositDisposition } = require('../services/bookingFinance');
const { isRazorpayEnabled, credentials, createOrRecoverOrder } = require('../services/razorpay');
const { toMinorUnits } = require('../services/ledger');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId, bookingDateRange } = require('../validators');
const idempotency = require('../middleware/idempotency');
const { validateDates, assertAvailable, withReservationLocks } = require('../services/availability');
const { resolveLegacyEquipmentIds, setAssetsLifecycle, inspectAssets } = require('../services/inventory');
const notify = require('../utils/notifications');

const router = express.Router();
router.use(protect);

function presentBooking(booking) {
  const value = booking.toObject ? booking.toObject() : { ...booking };
  if (value.status === 'pending_payment') value.status = 'pending';
  return value;
}

router.post('/holds',
  allowRoles('customer'),
  idempotency,
  body('equipmentIds').optional().isArray({ min: 1, max: 10 }).withMessage('Choose between 1 and 10 equipment items'),
  body('equipmentIds.*').optional().isMongoId().withMessage('Equipment IDs must be valid'),
  body('items').optional().isArray({ min: 1, max: 10 }).withMessage('Choose between 1 and 10 equipment items'),
  body('items.*.equipmentId').optional().isMongoId().withMessage('Equipment IDs must be valid'),
  body('items.*.quantity').optional().isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
  body('quantity').optional().isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
  body('packageId').optional().isMongoId().withMessage('packageId must be a valid ID'),
  ...bookingDateRange,
  validate,
  asyncHandler(async (req, res) => {
    const { start, end } = validateDates(req.body.startDate, req.body.endDate);
    const providedItems = Array.isArray(req.body.items) ? req.body.items
      : Array.isArray(req.body.equipmentIds) ? req.body.equipmentIds.map((equipmentId) => ({ equipmentId, quantity: req.body.quantity || 1 }))
        : null;
    if (Boolean(req.body.packageId) === Boolean(providedItems)) {
      throw new AppError('Provide either packageId or equipmentIds', 400, 'INVALID_RESERVATION_ITEMS');
    }
    const rentalPackage = req.body.packageId
      ? await Package.findOne({ _id: req.body.packageId, active: true })
      : null;
    if (req.body.packageId && !rentalPackage) throw new AppError('Package not found', 404, 'NOT_FOUND');
    const requestedIds = rentalPackage ? rentalPackage.equipment.map(String) : providedItems.map((item) => item.equipmentId);
    const resolvedIds = await resolveLegacyEquipmentIds(requestedIds);
    const ids = [...new Set(resolvedIds)];
    if (ids.length !== requestedIds.length) throw new AppError('Duplicate equipment IDs are not allowed', 400, 'DUPLICATE_ITEMS');
    const equipmentQuantities = resolvedIds.map((equipment, index) => ({
      equipment,
      quantity: rentalPackage ? 1 : Number(providedItems[index].quantity || 1)
    }));
    const hold = await withReservationLocks(ids, async () => {
      const items = await Equipment.find({ _id: { $in: ids }, active: true, status: 'available' });
      if (items.length !== ids.length) throw new AppError('One or more equipment items are unavailable', 404, 'ITEM_UNAVAILABLE');
      await assertAvailable(ids, start, end, undefined, equipmentQuantities);
      return ReservationHold.create({
        customer: req.user.id,
        equipment: ids,
        equipmentQuantities,
        assets: items.map((item) => item.assetRef),
        ...(rentalPackage ? { package: rentalPackage._id } : {}),
        startDate: start,
        endDate: end,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      });
    });
    return sendSuccess(res, 'Reservation hold created; complete checkout within 10 minutes', hold, 201);
  })
);

router.delete('/holds/:id', allowRoles('customer'), idempotency, objectId(), validate, asyncHandler(async (req, res) => {
  const hold = await ReservationHold.findOne({ _id: req.params.id, customer: req.user.id });
  if (!hold) throw new AppError('Reservation hold not found', 404, 'NOT_FOUND');
  if (hold.status !== 'active') throw new AppError('Only an active hold can be released', 409, 'INVALID_STATE');
  hold.status = 'released';
  await hold.save();
  return sendSuccess(res, 'Reservation hold released', hold);
}));

router.post('/',
  allowRoles('customer'),
  idempotency,
  body('holdId').optional().isMongoId().withMessage('holdId must be a valid ID'),
  body('equipmentId').optional().isMongoId().withMessage('equipmentId must be a valid ID'),
  body('address').optional().trim().notEmpty().withMessage('Delivery address must not be empty'),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    let existingHold = req.body.holdId
      ? await ReservationHold.findOne({
        _id: req.body.holdId, customer: req.user.id, status: 'active', expiresAt: { $gt: new Date() }
      })
      : null;
    if (!req.body.holdId && req.body.equipmentId) {
      const { start, end } = validateDates(req.body.startDate, req.body.endDate);
      const [equipmentId] = await resolveLegacyEquipmentIds([req.body.equipmentId]);
      existingHold = await withReservationLocks([equipmentId], async () => {
        const item = await Equipment.findOne({ _id: equipmentId, active: true, status: 'available' });
        if (!item) throw new AppError('Equipment is unavailable', 404, 'ITEM_UNAVAILABLE');
        await assertAvailable([item._id], start, end);
        return ReservationHold.create({
          customer: req.user.id, equipment: [item._id], assets: [item.assetRef], startDate: start, endDate: end,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        });
      });
    }
    if (!existingHold) throw new AppError('Hold is missing, expired, or already used', 409, 'HOLD_EXPIRED');
    let booking;
    let rental;
    let deliveries = [];
    try {
      await withReservationLocks(existingHold.equipment, async () => {
      const hold = await ReservationHold.findOneAndUpdate(
        { _id: existingHold._id, customer: req.user.id, status: 'active', expiresAt: { $gt: new Date() } },
        { $set: { status: 'converted' } },
        { new: true }
      );
      if (!hold) throw new AppError('Hold is missing, expired, or already used', 409, 'HOLD_EXPIRED');
      await assertAvailable(hold.equipment, hold.startDate, hold.endDate, undefined, hold.equipmentQuantities);
      const items = await Equipment.find({ _id: { $in: hold.equipment }, active: true });
      if (items.length !== hold.equipment.length) throw new AppError('An item is no longer available', 409, 'ITEM_UNAVAILABLE');
      const { rentalDays } = validateDates(hold.startDate, hold.endDate);
      const rentalPackage = hold.package ? await Package.findOne({ _id: hold.package, active: true }) : null;
      if (hold.package && !rentalPackage) throw new AppError('This package is no longer available', 409, 'PACKAGE_UNAVAILABLE');
      const owners = new Set(items.map((item) => item.owner.toString()));
      if (owners.size !== 1) throw new AppError('All items in a booking must belong to one owner', 400, 'MULTIPLE_OWNERS');
      const quantityByEquipment = new Map((hold.equipmentQuantities || []).map((line) => [String(line.equipment), line.quantity]));
      const subtotal = rentalPackage
        ? rentalPackage.dailyRate * rentalDays
        : items.reduce((sum, item) => sum + item.dailyRate * (quantityByEquipment.get(String(item._id)) || 1) * rentalDays, 0);
      const depositAmount = items.reduce((sum, item) => sum + item.depositAmount * (quantityByEquipment.get(String(item._id)) || 1), 0);
      booking = await Booking.create({
        customer: req.user.id,
        owner: items[0].owner,
        equipment: items.map((item) => item._id),
        equipmentQuantities: hold.equipmentQuantities,
        assets: hold.assets?.length ? hold.assets : items.map((item) => item.assetRef),
        ...(rentalPackage ? { package: rentalPackage._id } : {}),
        startDate: hold.startDate,
        endDate: hold.endDate,
        rentalDays,
        subtotal,
        depositAmount,
        totalAmount: subtotal + depositAmount,
        currency: 'INR',
        status: 'pending_payment',
        paymentExpiresAt: hold.expiresAt,
        hold: hold._id,
        notes: req.body.notes || ''
      });
      rental = await Rental.create({
        booking: booking._id,
        customer: booking.customer,
        owner: booking.owner,
        equipment: booking.equipment,
        equipmentQuantities: booking.equipmentQuantities,
        startDate: booking.startDate,
        endDate: booking.endDate,
        rentalDays: booking.rentalDays,
        pricing: {
          rentalSubtotal: booking.subtotal,
          securityDeposit: booking.depositAmount,
          grandTotal: booking.totalAmount,
          currency: booking.currency
        },
        deliveryAddress: req.body.address || items[0].location.city
      });
      booking.rental = rental._id;
      deliveries = await Delivery.insertMany(items.map((item) => ({
        rental: rental._id,
        booking: booking._id,
        equipment: item._id,
        customer: booking.customer,
        owner: booking.owner,
        address: req.body.address || item.location.city
      })));
      booking.deliveries = deliveries.map((item) => item._id);
      booking.delivery = deliveries[0]?._id;
      await booking.save();
      });
      await notify(booking.owner, 'booking_created', 'New booking request', 'A customer has requested an equipment rental.', { bookingId: booking.id });
      return sendSuccess(res, 'Booking created. Complete checkout within 10 minutes.', {
        booking: presentBooking(booking), reservationHold: existingHold
      }, 201);
    } catch (error) {
      if (deliveries.length) await Delivery.deleteMany({ _id: { $in: deliveries.map((item) => item._id) } });
      if (rental) await Rental.deleteOne({ _id: rental._id });
      if (booking) await Booking.deleteOne({ _id: booking._id });
      await ReservationHold.updateOne({ _id: existingHold._id, status: 'converted' }, { $set: { status: 'released' } });
      throw error;
    }
  })
);

router.post('/:id/pay', allowRoles('customer'), idempotency, objectId(), validate, asyncHandler(async (req, res) => {
  const now = new Date();
  const previousPayment = await Payment.findOne({
    booking: req.params.id, customer: req.user.id, status: 'succeeded'
  }).sort({ createdAt: 1 });
  if (previousPayment) {
    const paidBooking = await Booking.findOne({ _id: req.params.id, customer: req.user.id });
    if (!paidBooking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    if (!['pending_payment', 'payment_processing', 'approved', 'confirmed'].includes(paidBooking.status)) {
      throw new AppError('This booking cannot be confirmed from its current state', 409, 'INVALID_STATE');
    }
    if (paidBooking.status !== 'confirmed') {
      await postBookingPayment(previousPayment, paidBooking);
      paidBooking.status = 'confirmed';
      paidBooking.payment = previousPayment._id;
      await paidBooking.save();
    }
    await Deposit.findOneAndUpdate(
      { booking: paidBooking._id },
      { $setOnInsert: {
        customer: req.user.id,
        amount: paidBooking.depositAmount,
        currency: paidBooking.currency || 'INR'
      } },
      { new: true, upsert: true, runValidators: true }
    );
    return sendSuccess(res, 'Payment already processed', { booking: paidBooking, payment: previousPayment });
  }
  if (isRazorpayEnabled()) {
    const booking = await Booking.findOne({
      _id: req.params.id,
      customer: req.user.id,
      status: { $in: ['pending_payment', 'approved'] }
    });
    if (!booking) throw new AppError('Only your pending booking can be paid', 409, 'INVALID_STATE');
    if (!booking.paymentExpiresAt || booking.paymentExpiresAt <= now) {
      await Booking.updateOne(
        { _id: booking._id, status: booking.status, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $lte: now } }] },
        { $set: { status: 'cancelled' } }
      );
      throw new AppError('This reservation expired. Choose new dates and place another booking.', 409, 'HOLD_EXPIRED');
    }
    const operationKey = `booking:${booking._id}:checkout:${req.get('Idempotency-Key')}`;
    const activePayment = await Payment.findOne({
      booking: booking._id,
      customer: req.user.id,
      method: 'razorpay',
      status: 'pending',
      providerOrderId: { $exists: true }
    }).sort({ createdAt: -1 });
    const keyId = credentials().keyId;
    if (activePayment) {
      return sendSuccess(res, 'Continue your secure checkout', {
        booking,
        payment: activePayment,
        provider: 'razorpay',
        checkout: {
          keyId,
          orderId: activePayment.providerOrderId,
          amount: toMinorUnits(activePayment.amount),
          currency: activePayment.currency || 'INR',
          name: 'RentalHub',
          description: 'Equipment rental'
        }
      });
    }
    const amountMinor = toMinorUnits(booking.totalAmount);
    if (amountMinor < 100) throw new AppError('Razorpay checkout requires a minimum total of INR 1.00', 400, 'PAYMENT_AMOUNT_TOO_SMALL');
    const receipt = `rh_${crypto.createHash('sha256').update(operationKey).digest('hex').slice(0, 32)}`;
    let payment = await Payment.findOne({ operationKey });
    if (payment?.status === 'failed') {
      throw new AppError('This payment attempt failed. Start a new checkout attempt.', 409, 'PAYMENT_ATTEMPT_FAILED');
    }
    if (!payment) {
      const transactionId = `pending_${crypto.createHash('sha256').update(operationKey).digest('hex')}`;
      payment = await Payment.create({
        booking: booking._id,
        customer: req.user.id,
        amount: booking.totalAmount,
        currency: booking.currency || 'INR',
        method: 'razorpay',
        status: 'pending',
        transactionId,
        operationKey,
        providerReceipt: receipt
      });
    }
    const order = await createOrRecoverOrder({
      amountMinor,
      currency: booking.currency || 'INR',
      receipt,
      notes: { bookingId: String(booking._id), customerId: String(req.user.id) }
    });
    payment.transactionId = order.id;
    payment.providerOrderId = order.id;
    await payment.save();
    return sendSuccess(res, 'Secure checkout is ready', {
      booking,
      payment,
      provider: 'razorpay',
      checkout: {
        keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: 'RentalHub',
        description: 'Equipment rental',
        prefill: {
          name: req.user.name,
          email: req.user.email,
          contact: req.user.phone
        }
      }
    }, 201);
  }
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, customer: req.user.id, status: { $in: ['pending_payment', 'approved'] }, paymentExpiresAt: { $gt: now } },
    { $set: { status: 'payment_processing' } },
    { new: true }
  );
  if (!booking) {
    const ownedBooking = await Booking.findOne({ _id: req.params.id, customer: req.user.id });
    if (!ownedBooking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    if (['pending_payment', 'approved'].includes(ownedBooking.status) &&
      (!ownedBooking.paymentExpiresAt || ownedBooking.paymentExpiresAt <= now)) {
      await Booking.updateOne(
        { _id: ownedBooking._id, status: ownedBooking.status, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $lte: now } }] },
        { $set: { status: 'cancelled' } }
      );
      throw new AppError('This reservation expired. Choose new dates and place another booking.', 409, 'HOLD_EXPIRED');
    }
    throw new AppError('Only a pending booking can be paid', 409, 'INVALID_STATE');
  }
  try {
    const payment = await Payment.create({
      booking: booking._id,
      customer: req.user.id,
      amount: booking.totalAmount,
      currency: booking.currency || 'INR',
      status: 'succeeded',
      method: 'mock',
      transactionId: `mock_${crypto.randomUUID()}`,
      operationKey: `booking:${booking._id}:payment:v1`
    });
    await postBookingPayment(payment, booking);
    booking.payment = payment._id;
    booking.status = 'confirmed';
    await booking.save();
    await Deposit.create({ booking: booking._id, customer: req.user.id, amount: booking.depositAmount, currency: booking.currency || 'INR' });
    await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
      equipment, booking: booking._id, actor: req.user.id, type: 'booking_confirmed', details: { payment: payment._id }
    })));
    await notify(booking.owner, 'booking_confirmed', 'Booking confirmed', 'An equipment booking has been paid and confirmed.', { bookingId: booking.id });
    return sendSuccess(res, 'Mock payment succeeded', { booking, payment });
  } catch (error) {
    await Booking.updateOne({ _id: booking._id, status: 'payment_processing' }, { $set: { status: 'pending_payment' } });
    throw error;
  }
}));

router.post('/:id/hold', allowRoles('customer'), idempotency, objectId(), validate, asyncHandler(async (req, res) => {
  const now = new Date();
  const booking = await Booking.findOne({ _id: req.params.id, customer: req.user.id, status: { $in: ['pending_payment', 'approved'] } });
  if (!booking) throw new AppError('Only your pending booking can be held', 404, 'NOT_FOUND');
  if (!booking.paymentExpiresAt || booking.paymentExpiresAt <= now) {
    await Booking.updateOne(
      { _id: booking._id, status: booking.status, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $lte: now } }] },
      { $set: { status: 'cancelled' } }
    );
    throw new AppError('This reservation expired. Choose new dates and place another booking.', 409, 'HOLD_EXPIRED');
  }
  return sendSuccess(res, 'Booking dates are held until checkout expires', {
    booking,
    expiresAt: booking.paymentExpiresAt
  });
}));

router.get(['/my', '/mine'], allowRoles('customer'), asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ customer: req.user.id })
    .populate('equipment', 'name images dailyRate')
    .populate('owner', 'name')
    .populate('rental', 'status startDate endDate paymentStatus')
    .populate('delivery')
    .sort({ createdAt: -1 });
  const reviews = await Review.find({ booking: { $in: bookings.map((booking) => booking._id) } })
    .select('booking rating comment createdAt').lean();
  const reviewByBooking = new Map(reviews.map((review) => [String(review.booking), review]));
  return sendSuccess(res, 'Your bookings', bookings.map((booking) => ({
    ...presentBooking(booking),
    review: reviewByBooking.get(String(booking._id)) || null
  })));
}));

router.get('/:id', allowRoles('customer', 'owner', 'admin'), objectId(), validate, asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('equipment')
    .populate('customer', 'name email')
    .populate('owner', 'name email')
    .populate('payment')
    .populate('delivery');
  if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
  if (req.user.role !== 'admin' && booking.customer.id !== req.user.id && booking.owner.id !== req.user.id) {
    throw new AppError('You cannot view this booking', 403, 'FORBIDDEN');
  }
  return sendSuccess(res, 'Booking details', presentBooking(booking));
}));

router.post('/:id/cancel', allowRoles('customer'), idempotency, objectId(), body('reason').optional().isString().isLength({ max: 1000 }), validate, asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, customer: req.user.id });
  if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
  if (booking.status === 'cancelled') {
    await settleBookingCancellation(booking);
    return sendSuccess(res, 'Booking cancellation and refunds already processed', booking);
  }
  if (!['pending_payment', 'approved', 'confirmed'].includes(booking.status) || booking.startDate <= new Date()) {
    throw new AppError('This booking cannot be cancelled', 409, 'INVALID_STATE');
  }
  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, customer: req.user.id, status: booking.status, startDate: { $gt: new Date() } },
    { $set: { status: 'cancelled', cancelledBy: req.user.id, cancellationReason: req.body.reason || '', cancelledAt: new Date() } },
    { new: true }
  );
  if (!cancelled) throw new AppError('Booking changed while cancellation was being processed', 409, 'INVALID_STATE');
  await settleBookingCancellation(cancelled);
  return sendSuccess(res, 'Booking cancelled; mock payment and deposit refunded when applicable', cancelled);
}));

router.patch('/:id/status', allowRoles('customer', 'owner'), idempotency, objectId(), body('status').isIn([
  'confirmed', 'approved', 'cancelled', 'rejected', 'declined', 'in_progress', 'completed'
]), body('reason').optional().isString().isLength({ max: 1000 }), validate, asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
  const desired = req.body.status;

  if (req.user.role === 'customer' && booking.customer.toString() === req.user.id) {
    if (!['cancelled', 'rejected', 'declined'].includes(desired)) {
      throw new AppError('Customers may only cancel their own booking', 403, 'FORBIDDEN');
    }
    if (booking.status === 'cancelled') {
      await settleBookingCancellation(booking);
      return sendSuccess(res, 'Booking cancellation and refunds already processed', booking);
    }
    if (!['pending_payment', 'approved', 'confirmed'].includes(booking.status) || booking.startDate <= new Date()) {
      throw new AppError('This booking cannot be cancelled', 409, 'INVALID_STATE');
    }
    booking.status = 'cancelled';
    booking.cancelledBy = req.user.id;
    booking.cancellationReason = req.body.reason || '';
    booking.cancelledAt = new Date();
    await booking.save();
    await setAssetsLifecycle(booking.equipment, 'listed');
    await settleBookingCancellation(booking);
    return sendSuccess(res, 'Booking cancelled', booking);
  }
  if (req.user.role !== 'owner' || booking.owner.toString() !== req.user.id) {
    throw new AppError('Only the booking owner may update its status', 403, 'FORBIDDEN');
  }
  if (desired === 'cancelled' && booking.status === 'cancelled') {
    await settleBookingCancellation(booking);
    return sendSuccess(res, 'Booking cancellation and refunds already processed', booking);
  }

  if (['confirmed', 'approved'].includes(desired)) {
    const priorPayment = await Payment.findOne({
      booking: booking._id,
      operationKey: `booking:${booking._id}:payment:v1`,
      status: 'succeeded'
    });
    if (priorPayment && ['pending_payment', 'payment_processing', 'confirmed'].includes(booking.status)) {
      await postBookingPayment(priorPayment, booking);
      const recovered = await Booking.findOneAndUpdate(
        { _id: booking._id, status: { $in: ['pending_payment', 'payment_processing', 'confirmed'] } },
        { $set: { status: 'confirmed', payment: priorPayment._id } },
        { new: true }
      );
      if (!recovered) throw new AppError('Booking changed while payment recovery was being processed', 409, 'INVALID_STATE');
      await Deposit.findOneAndUpdate(
        { booking: booking._id },
        { $setOnInsert: {
          customer: booking.customer,
          amount: booking.depositAmount,
          currency: booking.currency || 'INR'
        } },
        { new: true, upsert: true, runValidators: true }
      );
      return sendSuccess(res, 'Booking payment already processed', recovered);
    }
    if (booking.status !== 'pending_payment') throw new AppError('Only a pending booking can be accepted', 409, 'INVALID_STATE');
    if (!booking.paymentExpiresAt || booking.paymentExpiresAt <= new Date()) {
      throw new AppError('The booking hold has expired', 409, 'HOLD_EXPIRED');
    }
    if (isRazorpayEnabled()) {
      const approved = await Booking.findOneAndUpdate(
        { _id: booking._id, owner: booking.owner, status: 'pending_payment' },
        { $set: { status: 'approved' } },
        { new: true }
      );
      if (!approved) throw new AppError('Booking changed while approval was processed', 409, 'INVALID_STATE');
      await notify(approved.customer, 'booking_approved', 'Booking approved', 'The owner approved your rental. Complete checkout to confirm it.', { bookingId: approved.id });
      return sendSuccess(res, 'Booking approved; customer payment is still required', approved);
    }
    const accepted = await Booking.findOneAndUpdate(
      { _id: booking._id, owner: booking.owner, status: 'pending_payment' },
      { $set: { status: 'payment_processing' } }, { new: true }
    );
    if (!accepted) throw new AppError('Booking changed while acceptance was processed', 409, 'INVALID_STATE');
    try {
      const payment = await Payment.create({
        booking: accepted._id, customer: accepted.customer, amount: accepted.totalAmount, currency: accepted.currency || 'INR',
        method: 'mock', status: 'succeeded', transactionId: `mock_${crypto.randomUUID()}`,
        operationKey: `booking:${accepted._id}:payment:v1`
      });
      await postBookingPayment(payment, accepted);
      const confirmed = await Booking.findOneAndUpdate(
        { _id: accepted._id, status: 'payment_processing' },
        { $set: { status: 'confirmed', payment: payment._id } }, { new: true }
      );
      await Deposit.findOneAndUpdate(
        { booking: accepted._id },
        { $setOnInsert: {
          customer: accepted.customer,
          amount: accepted.depositAmount,
          currency: accepted.currency || 'INR'
        } },
        { new: true, upsert: true, runValidators: true }
      );
      await EquipmentEvent.insertMany(accepted.equipment.map((equipment) => ({
        equipment, booking: accepted._id, actor: req.user.id, type: 'booking_confirmed', details: { payment: payment._id }
      })));
      await notify(accepted.customer, 'booking_confirmed', 'Booking confirmed', 'The owner accepted and confirmed your rental.', { bookingId: accepted.id });
      return sendSuccess(res, 'Booking accepted and mock payment processed', confirmed);
    } catch (error) {
      await Booking.updateOne({ _id: accepted._id, status: 'payment_processing' }, { $set: { status: 'pending_payment' } });
      throw error;
    }
  }
  if (['cancelled', 'rejected', 'declined'].includes(desired)) {
    if (!['pending_payment', 'approved', 'confirmed'].includes(booking.status) || booking.startDate <= new Date()) {
      throw new AppError('This booking cannot be cancelled', 409, 'INVALID_STATE');
    }
    booking.status = 'cancelled';
    booking.cancelledBy = req.user.id;
    booking.cancellationReason = req.body.reason || '';
    booking.cancelledAt = new Date();
    await booking.save();
    await setAssetsLifecycle(booking.equipment, 'listed');
    await settleBookingCancellation(booking);
    await notify(booking.customer, 'booking_cancelled', 'Booking cancelled', 'The owner declined your booking.', { bookingId: booking.id });
    return sendSuccess(res, 'Booking cancelled', booking);
  }
  if (desired === 'in_progress') {
    if (booking.status !== 'confirmed') throw new AppError('Only a confirmed booking can start', 409, 'INVALID_STATE');
    const started = await Booking.findOneAndUpdate(
      { _id: booking._id, owner: booking.owner, status: 'confirmed' },
      { $set: { status: 'in_progress' } },
      { new: true }
    );
    if (!started) throw new AppError('Booking changed while it was being started', 409, 'INVALID_STATE');
    await setAssetsLifecycle(started.equipment, 'in_service');
    await EquipmentEvent.insertMany(started.equipment.map((equipment) => ({
      equipment, booking: started._id, actor: req.user.id, type: 'booking_in_progress'
    })));
    await notify(started.customer, 'booking_in_progress', 'Rental started', 'The owner has marked your rental as in progress.', { bookingId: started.id });
    return sendSuccess(res, 'Rental started', started);
  }
  if (desired === 'completed') {
    if (booking.status !== 'return_pending') throw new AppError('Only a returned booking can be completed', 409, 'INVALID_STATE');
    const delivery = await Delivery.findOne({ booking: booking._id, status: 'returned' });
    const deposit = await Deposit.findOne({ booking: booking._id });
    if (!delivery) throw new AppError('Equipment return must be recorded before completing the booking', 409, 'RETURN_NOT_CONFIRMED');
    if (!deposit || ['held', 'refund_pending', 'refund_failed'].includes(deposit.status)) {
      throw new AppError('Inspect the equipment and finish deposit processing before completing the booking', 409, 'DEPOSIT_NOT_INSPECTED');
    }
    const completed = await Booking.findOneAndUpdate(
      { _id: booking._id, owner: booking.owner, status: 'return_pending' },
      { $set: { status: 'completed' } }, { new: true }
    );
    if (!completed) throw new AppError('Booking changed while completion was processed', 409, 'INVALID_STATE');
    await setAssetsLifecycle(completed.equipment, 'listed');
    await EquipmentEvent.insertMany(completed.equipment.map((equipment) => ({
      equipment, booking: completed._id, actor: req.user.id, type: 'booking_completed'
    })));
    return sendSuccess(res, 'Booking completed', completed);
  }
  throw new AppError('That booking status transition is not available through this endpoint', 409, 'INVALID_STATE');
}));

router.post('/:id/return', allowRoles('customer', 'owner'), idempotency, objectId(), validate, asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
  const ownerRecordingReturn = req.user.role === 'owner' && booking.owner.toString() === req.user.id;
  const customerRequestingReturn = req.user.role === 'customer' && booking.customer.toString() === req.user.id;
  if (!ownerRecordingReturn && !customerRequestingReturn) throw new AppError('You cannot update this booking return', 403, 'FORBIDDEN');
  if (!(ownerRecordingReturn ? ['confirmed', 'in_progress'] : ['in_progress']).includes(booking.status)) {
    throw new AppError('Only an active rental can be returned', 409, 'INVALID_STATE');
  }
  booking.status = 'return_pending';
  await booking.save();
  if (ownerRecordingReturn) {
    await Delivery.updateOne(
      { booking: booking._id, status: { $in: ['delivered', 'pickup_scheduled', 'scheduled'] } },
      { $set: { status: 'returned', returnedAt: new Date(), updatedBy: req.user.id, notes: req.body.notes || '' } }
    );
  }
  await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
    equipment, booking: booking._id, actor: req.user.id,
    type: ownerRecordingReturn ? 'return_received' : 'return_requested',
    details: { notes: req.body.notes || '' }
  })));
  await notify(ownerRecordingReturn ? booking.customer : booking.owner,
    ownerRecordingReturn ? 'return_received' : 'return_requested',
    ownerRecordingReturn ? 'Return recorded' : 'Return requested',
    ownerRecordingReturn ? 'The owner recorded your equipment return.' : 'A renter has requested a return inspection.',
    { bookingId: booking.id });
  return sendSuccess(res, ownerRecordingReturn ? 'Equipment return recorded' : 'Return inspection requested', booking);
}));

router.post('/:id/inspection',
  allowRoles('owner'),
  idempotency,
  objectId(),
  body('condition').optional().isIn(['good', 'minor_damage', 'needs_repair', 'new', 'excellent', 'fair']),
  body('deductionAmount').optional().isFloat({ min: 0 }),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user.id });
    if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    if (['confirmed', 'in_progress'].includes(booking.status)) {
      booking.status = 'return_pending';
      await booking.save();
      await Delivery.updateOne(
        { booking: booking._id, status: { $in: ['delivered', 'pickup_scheduled', 'scheduled'] } },
        { $set: { status: 'returned', returnedAt: new Date(), updatedBy: req.user.id, notes: req.body.notes || '' } }
      );
    }
    if (booking.status !== 'return_pending') throw new AppError('Booking must be returned before inspection', 409, 'INVALID_STATE');
    let deposit = await Deposit.findOne({ booking: booking._id });
    if (!deposit) deposit = await Deposit.create({ booking: booking._id, customer: booking.customer, amount: booking.depositAmount });
    const condition = req.body.condition || 'good';
    const deduction = req.body.deductionAmount === undefined
      ? condition === 'needs_repair' ? deposit.amount : condition === 'minor_damage' ? Math.round(deposit.amount * 0.25 * 100) / 100 : 0
      : Number(req.body.deductionAmount);
    if (deduction > deposit.amount) throw new AppError('Deduction cannot exceed the deposit amount', 400, 'INVALID_DEDUCTION');
    if (deposit.status !== 'held') {
      const sameInspection = String(deposit.inspectedBy) === req.user.id &&
        deposit.deductionAmount === deduction &&
        deposit.inspectionNotes === [condition, req.body.notes].filter(Boolean).join(': ');
      if (!sameInspection) throw new AppError('Deposit inspection has already been processed', 409, 'INVALID_STATE');
      const disposition = await settleDepositDisposition(deposit);
      return sendSuccess(res, 'Deposit inspection already processed', { booking, deposit: disposition.deposit });
    }
    const processed = await Deposit.findOneAndUpdate(
      { _id: deposit._id, status: 'held' },
      { $set: {
        deductionAmount: deduction,
        refundAmount: deposit.amount - deduction,
        status: deposit.amount - deduction > 0 ? 'refund_pending' : deduction === 0 ? 'refunded' : 'forfeited',
        inspectionNotes: [condition, req.body.notes].filter(Boolean).join(': '),
        inspectedBy: req.user.id,
        inspectedAt: new Date()
      } }, { new: true }
    );
    if (!processed) throw new AppError('Deposit was already processed', 409, 'INVALID_STATE');
    await inspectAssets(booking.equipment, condition);
    const disposition = await settleDepositDisposition(processed);
    booking.depositRefunded = processed.status !== 'refund_pending';
    await booking.save();
    await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
      equipment, booking: booking._id, actor: req.user.id, type: 'return_inspected',
      details: { condition, refundAmount: processed.refundAmount, deductionAmount: deduction, notes: req.body.notes || '' }
    })));
    await notify(booking.customer, 'deposit_processed', 'Deposit inspection complete',
      processed.status === 'refund_pending'
        ? `Deposit refund of ${processed.refundAmount} is being processed.`
        : `Deposit refund: ${processed.refundAmount}.`,
      { bookingId: booking.id });
    return sendSuccess(res, processed.status === 'refund_pending'
      ? 'Return inspected; payment provider is processing the deposit refund'
      : 'Return inspected; deposit disposition is complete', { booking, deposit: disposition.deposit });
  })
);

router.post('/:id/reviews',
  allowRoles('customer'),
  idempotency,
  objectId(),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be from 1 to 5'),
  body('comment').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findOne({ _id: req.params.id, customer: req.user.id, status: 'completed' });
    if (!booking) throw new AppError('A review requires a completed booking you own', 403, 'FORBIDDEN');
    if (booking.equipment.length !== 1) throw new AppError('Review each item in a multi-item booking separately is not supported', 400, 'INVALID_BOOKING');
    if (await Review.exists({ booking: booking._id })) throw new AppError('This rental has already been reviewed', 409, 'REVIEW_EXISTS');
    const review = await Review.create({
      booking: booking._id, rental: booking.rental || null, customer: req.user.id, owner: booking.owner, equipment: booking.equipment[0],
      rating: Number(req.body.rating), comment: req.body.comment || ''
    });
    return sendSuccess(res, 'Review created', review, 201);
  })
);

module.exports = router;
