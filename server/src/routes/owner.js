const express = require('express');
const Equipment = require('../models/Equipment');
const Category = require('../models/Category');
const Booking = require('../models/Booking');
const Delivery = require('../models/Delivery');
const Deposit = require('../models/Deposit');
const Payment = require('../models/Payment');
const EquipmentEvent = require('../models/EquipmentEvent');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../utils/validation');
const idempotency = require('../middleware/idempotency');
const notify = require('../utils/notifications');
const Package = require('../models/Package');
const SwapRequest = require('../models/SwapRequest');
const { syncAssetForLegacy, setAssetsLifecycle, inspectAssets } = require('../services/inventory');
const { settleBookingCancellation, settleDepositDisposition } = require('../services/bookingFinance');

const router = express.Router();
router.use((req, res, next) => {
  const protectedPath = req.baseUrl.endsWith('/owner') ||
    /^\/(equipment|bookings)(\/|$)/.test(req.path) || req.path === '/owner/swaps';
  if (!protectedPath) return next();
  return protect(req, res, () => allowRoles('owner')(req, res, next));
});
router.use((req, res, next) => (
  req.user && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    ? idempotency(req, res, next)
    : next()
));

function equipmentInput(bodyData) {
  const location = typeof bodyData.location === 'string'
    ? { city: bodyData.location.trim(), region: '' }
    : bodyData.location;
  const dailyRate = Number(bodyData.dailyRate ?? bodyData.pricePerDay ?? bodyData.price);
  return {
    category: bodyData.category,
    name: bodyData.name,
    description: bodyData.description,
    brand: bodyData.brand || '',
    dailyRate,
    replacementValue: Number(bodyData.replacementValue ?? dailyRate * 10),
    depositAmount: Number(bodyData.depositAmount ?? 0),
    location,
    images: bodyData.images || (bodyData.imageUrl ? [bodyData.imageUrl] : bodyData.image ? [bodyData.image] : []),
    condition: bodyData.condition || 'good',
    swapTypes: bodyData.swapTypes || [],
    status: ['active', 'available'].includes(bodyData.status || bodyData.availability) ? 'available'
      : ['inactive', 'unavailable'].includes(bodyData.status || bodyData.availability) ? 'unavailable'
        : bodyData.status || 'available'
  };
}

async function resolveCategory(categoryInput) {
  if (!categoryInput) return null;
  if (String(categoryInput).match(/^[a-f\d]{24}$/i)) return Category.findById(categoryInput);
  return Category.findOne({ $or: [{ name: new RegExp(`^${String(categoryInput).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { slug: String(categoryInput).toLowerCase() }] });
}

function presentEquipment(item) {
  const value = item.toObject ? item.toObject() : { ...item };
  value.availability = value.status === 'available' ? 'available' : value.status;
  value.status = value.status === 'available' ? 'active' : value.status === 'unavailable' ? 'inactive' : value.status;
  value.location = value.location?.city || '';
  value.imageUrl = value.images?.[0] || '';
  return value;
}

function presentBooking(booking) {
  const value = booking.toObject ? booking.toObject() : { ...booking };
  if (value.status === 'pending_payment') value.status = 'pending';
  return value;
}

const equipmentValidators = [
  body('category').notEmpty(),
  body('name').trim().notEmpty().isLength({ max: 140 }),
  body('description').trim().notEmpty(),
  body('dailyRate').optional().isFloat({ min: 0 }),
  body('pricePerDay').optional().isFloat({ min: 0 }),
  body('price').optional().isFloat({ min: 0 }),
  body().custom((value) => [value.dailyRate, value.pricePerDay, value.price].some((rate) => Number.isFinite(Number(rate)) && Number(rate) >= 0)).withMessage('A non-negative dailyRate is required'),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('location').custom((value) => typeof value === 'string' ? Boolean(value.trim()) : Boolean(value?.city?.trim())).withMessage('Location city is required'),
  body('availability').optional().isIn(['active', 'inactive', 'available', 'unavailable']),
  body('images').optional().isArray(),
  body('imageUrl').optional({ checkFalsy: true }).isURL(),
  body('condition').optional().isIn(['new', 'excellent', 'good', 'fair']),
  body('status').optional().isIn(['available', 'unavailable', 'maintenance']),
  body('swapTypes').optional().isArray()
];

router.get('/equipment', asyncHandler(async (req, res) => {
  const items = await Equipment.find({ owner: req.user.id }).populate('category', 'name slug names aliases').sort({ createdAt: -1 });
  return sendSuccess(res, 'Your equipment', items.map(presentEquipment));
}));

router.post('/equipment', ...equipmentValidators, validate, asyncHandler(async (req, res) => {
  if (!req.user.ownerVerified) throw new AppError('Your owner account must be verified before listing equipment', 403, 'OWNER_NOT_VERIFIED');
  const category = await resolveCategory(req.body.category);
  if (!category) throw new AppError('Category not found', 400, 'INVALID_CATEGORY');
  const item = await Equipment.create({ ...equipmentInput(req.body), category: category._id, owner: req.user.id });
  await syncAssetForLegacy(item);
  return sendSuccess(res, 'Equipment created', presentEquipment(item), 201);
}));

router.get('/equipment/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const item = await Equipment.findOne({ _id: req.params.id, owner: req.user.id }).populate('category', 'name slug names aliases');
  if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  return sendSuccess(res, 'Your equipment', presentEquipment(item));
}));

const optionalEquipmentValidators = [
  body('category').optional().notEmpty(),
  body('name').optional().trim().notEmpty().isLength({ max: 140 }),
  body('description').optional().trim().notEmpty(),
  body('dailyRate').optional().isFloat({ min: 0 }),
  body('pricePerDay').optional().isFloat({ min: 0 }),
  body('price').optional().isFloat({ min: 0 }),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('location').optional().custom((value) => typeof value === 'string' ? Boolean(value.trim()) : Boolean(value?.city?.trim())),
  body('availability').optional().isIn(['active', 'inactive', 'available', 'unavailable']),
  body('status').optional().isIn(['active', 'inactive', 'available', 'unavailable', 'maintenance']),
  body('images').optional().isArray(),
  body('imageUrl').optional({ checkFalsy: true }).isURL(),
  body('condition').optional().isIn(['new', 'excellent', 'good', 'fair']),
  body('swapTypes').optional().isArray()
];

router.patch('/equipment/:id', objectId(), ...optionalEquipmentValidators, validate,
  asyncHandler(async (req, res) => {
    const item = await Equipment.findOne({ _id: req.params.id, owner: req.user.id });
    if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    if (item.reservationLock) throw new AppError('Item is being reserved; retry shortly', 409, 'RESERVATION_BUSY');
    const input = equipmentInput({ ...item.toObject(), ...req.body });
    const allowed = ['name', 'description', 'brand', 'dailyRate', 'replacementValue', 'depositAmount', 'location', 'images', 'condition', 'swapTypes', 'status'];
    for (const field of allowed) if (req.body[field] !== undefined || (field === 'status' && req.body.availability !== undefined)) item[field] = input[field];
    if (req.body.imageUrl !== undefined) item.images = [req.body.imageUrl];
    if (req.body.category) {
      const category = await resolveCategory(req.body.category);
      if (!category) throw new AppError('Category not found', 400, 'INVALID_CATEGORY');
      item.category = category._id;
    }
    await item.save();
    await syncAssetForLegacy(item);
    return sendSuccess(res, 'Equipment updated', presentEquipment(item));
  })
);

router.delete('/equipment/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const item = await Equipment.findOne({ _id: req.params.id, owner: req.user.id });
  if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const Booking = require('../models/Booking');
  const activeBooking = await Booking.exists({
    equipment: item._id, status: { $in: ['pending_payment', 'confirmed', 'in_progress', 'return_pending'] },
    endDate: { $gt: new Date() }
  });
  if (activeBooking) throw new AppError('Equipment with an active booking cannot be removed', 409, 'ACTIVE_BOOKING');
  item.active = false;
  await item.save();
  await syncAssetForLegacy(item);
  return sendSuccess(res, 'Equipment archived', item);
}));

router.put('/equipment/:id', objectId(), ...optionalEquipmentValidators, validate,
  asyncHandler(async (req, res) => {
    const item = await Equipment.findOne({ _id: req.params.id, owner: req.user.id });
    if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    if (item.reservationLock) throw new AppError('Item is being reserved; retry shortly', 409, 'RESERVATION_BUSY');
    const input = equipmentInput({ ...item.toObject(), ...req.body });
    for (const field of ['name', 'description', 'brand', 'dailyRate', 'replacementValue', 'depositAmount', 'location', 'images', 'condition', 'swapTypes', 'status']) {
      if (req.body[field] !== undefined || (field === 'status' && req.body.availability !== undefined)) item[field] = input[field];
    }
    if (req.body.imageUrl !== undefined) item.images = [req.body.imageUrl];
    if (req.body.category) {
      const category = await resolveCategory(req.body.category);
      if (!category) throw new AppError('Category not found', 400, 'INVALID_CATEGORY');
      item.category = category._id;
    }
    await item.save();
    await syncAssetForLegacy(item);
    return sendSuccess(res, 'Equipment updated', presentEquipment(item));
  })
);

router.get('/bookings', asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ owner: req.user.id })
    .populate('equipment', 'name images')
    .populate('customer', 'name email phone')
    .populate('delivery')
    .sort({ createdAt: -1 });
  return sendSuccess(res, 'Owner bookings', bookings.map(presentBooking));
}));

router.get(['/swaps', '/owner/swaps'], asyncHandler(async (req, res) => {
  const swaps = await SwapRequest.find({ recipient: req.user.id })
    .populate('booking', 'startDate endDate status')
    .populate('requester', 'name email')
    .populate('offeredEquipment requestedEquipment', 'name images dailyRate replacementValue')
    .sort({ createdAt: -1 });
  const presented = swaps.map((swap) => {
    const value = swap.toObject();
    value.type = value.rentalType || (value.swapType === 'item_plus_cash' ? 'UPGRADE' :
      value.swapType === 'cash_for_item' ? 'DOWNGRADE' : 'FAILURE_REPLACEMENT');
    value.description = value.message;
    value.customer = value.requester;
    return value;
  });
  return sendSuccess(res, 'Swap requests for your equipment', presented);
}));

router.patch('/bookings/:id/status',
  objectId(),
  body('status').isIn(['in_progress', 'cancelled', 'completed']).withMessage('Unsupported owner booking status'),
  validate,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user.id });
    if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    if (req.body.status === 'cancelled' && booking.status === 'cancelled') {
      await settleBookingCancellation(booking);
      return sendSuccess(res, 'Booking cancellation and refunds already processed', booking);
    }
    const transitions = {
      confirmed: ['in_progress', 'cancelled'],
      approved: ['cancelled'],
      in_progress: [],
      return_pending: ['completed']
    };
    if (!(transitions[booking.status] || []).includes(req.body.status)) {
      throw new AppError(`Cannot change booking from ${booking.status} to ${req.body.status}`, 409, 'INVALID_STATE');
    }
    if (req.body.status === 'completed') {
      const delivery = await Delivery.findOne({ booking: booking._id });
      if (!delivery || delivery.status !== 'returned') {
        throw new AppError('Mark the delivery returned before completing the inspection', 409, 'RETURN_NOT_CONFIRMED');
      }
      const deposit = await Deposit.findOne({ booking: booking._id });
      if (deposit && ['held', 'refund_pending', 'refund_failed'].includes(deposit.status)) {
        throw new AppError('Inspect and process the deposit before completing the booking', 409, 'DEPOSIT_NOT_INSPECTED');
      }
    }
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, owner: req.user.id, status: booking.status },
      { $set: { status: req.body.status } },
      { new: true }
    );
    if (!updatedBooking) throw new AppError('Booking changed while the update was being processed', 409, 'INVALID_STATE');
    if (updatedBooking.status === 'in_progress') await setAssetsLifecycle(updatedBooking.equipment, 'in_service');
    if (['cancelled', 'completed'].includes(updatedBooking.status)) await setAssetsLifecycle(updatedBooking.equipment, 'listed');
    await EquipmentEvent.insertMany(updatedBooking.equipment.map((equipment) => ({
      equipment, booking: updatedBooking._id, actor: req.user.id, type: `booking_${updatedBooking.status}`
    })));
    if (updatedBooking.status === 'cancelled') await notify(updatedBooking.customer, 'booking_cancelled', 'Booking cancelled', 'The owner cancelled your booking.', { bookingId: updatedBooking.id });
    if (updatedBooking.status === 'cancelled') {
      await settleBookingCancellation(updatedBooking);
    }
    return sendSuccess(res, 'Booking status updated', updatedBooking);
  })
);

router.patch('/bookings/:id/delivery',
  objectId(),
  body('status').isIn(['out_for_delivery', 'delivered', 'pickup_scheduled', 'returned']).withMessage('Invalid delivery status'),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user.id });
    if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    const delivery = await Delivery.findOne({ booking: booking._id });
    if (!delivery) throw new AppError('Delivery record not found', 404, 'NOT_FOUND');
    const transitions = {
      scheduled: ['out_for_delivery'],
      out_for_delivery: ['delivered'],
      delivered: ['pickup_scheduled'],
      pickup_scheduled: ['returned'],
      returned: []
    };
    if (!(transitions[delivery.status] || []).includes(req.body.status)) {
      throw new AppError(`Cannot change delivery from ${delivery.status} to ${req.body.status}`, 409, 'INVALID_STATE');
    }
    if (['out_for_delivery', 'delivered'].includes(req.body.status) && !['confirmed', 'in_progress'].includes(booking.status)) {
      throw new AppError('Delivery can only be fulfilled for a confirmed booking', 409, 'INVALID_STATE');
    }
    if (['pickup_scheduled', 'returned'].includes(req.body.status) && booking.status !== 'return_pending') {
      throw new AppError('Pickup can only be completed after a return was requested', 409, 'INVALID_STATE');
    }
    const previousStatus = delivery.status;
    const updatedDelivery = await Delivery.findOneAndUpdate(
      { _id: delivery._id, status: previousStatus },
      { $set: {
        status: req.body.status,
        updatedBy: req.user.id,
        notes: req.body.notes || delivery.notes,
        ...(req.body.status === 'delivered' ? { deliveredAt: new Date() } : {}),
        ...(req.body.status === 'returned' ? { returnedAt: new Date() } : {})
      } },
      { new: true }
    );
    if (!updatedDelivery) throw new AppError('Delivery changed while the update was being processed', 409, 'INVALID_STATE');
    await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
      equipment, booking: booking._id, actor: req.user.id, type: `delivery_${updatedDelivery.status}`
    })));
    return sendSuccess(res, 'Delivery status updated', updatedDelivery);
  })
);

router.post('/bookings/:id/inspection',
  objectId(),
  body('condition').optional().isIn(['good', 'minor_damage', 'needs_repair', 'new', 'excellent', 'fair']),
  body('deductionAmount').isFloat({ min: 0 }).withMessage('deductionAmount must be non-negative'),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user.id, status: 'return_pending' });
    if (!booking) throw new AppError('Return-pending booking not found', 404, 'NOT_FOUND');
    const delivery = await Delivery.findOne({ booking: booking._id, status: 'returned' });
    if (!delivery) throw new AppError('Confirm that equipment was returned before inspection', 409, 'RETURN_NOT_CONFIRMED');
    const deposit = await Deposit.findOne({ booking: booking._id });
    if (!deposit) throw new AppError('Deposit is not awaiting inspection', 409, 'INVALID_STATE');
    const deduction = Number(req.body.deductionAmount);
    if (deduction > deposit.amount) throw new AppError('Deduction cannot exceed the deposit amount', 400, 'INVALID_DEDUCTION');
    if (deposit.status !== 'held') {
      const sameInspection = String(deposit.inspectedBy) === req.user.id &&
        deposit.deductionAmount === deduction &&
        deposit.inspectionNotes === (req.body.notes || '');
      if (!sameInspection) throw new AppError('Deposit inspection has already been processed', 409, 'INVALID_STATE');
      const disposition = await settleDepositDisposition(deposit);
      return sendSuccess(res, 'Deposit inspection already processed', { booking, deposit: disposition.deposit });
    }
    const processedDeposit = await Deposit.findOneAndUpdate(
      { _id: deposit._id, status: 'held' },
      { $set: {
        deductionAmount: deduction,
        refundAmount: deposit.amount - deduction,
        status: deposit.amount - deduction > 0 ? 'refund_pending' : deduction === 0 ? 'refunded' : 'forfeited',
        inspectionNotes: req.body.notes || '',
        inspectedBy: req.user.id,
        inspectedAt: new Date()
      } },
      { new: true }
    );
    if (!processedDeposit) throw new AppError('Deposit was already processed', 409, 'INVALID_STATE');
    await inspectAssets(booking.equipment, req.body.condition || (deduction > 0 ? 'minor_damage' : 'good'));
    const disposition = await settleDepositDisposition(processedDeposit);
    booking.depositRefunded = processedDeposit.status !== 'refund_pending';
    await booking.save();
    await EquipmentEvent.insertMany(booking.equipment.map((equipment) => ({
      equipment, booking: booking._id, actor: req.user.id, type: 'return_inspected',
      details: { refundAmount: processedDeposit.refundAmount, deductionAmount: deduction }
    })));
    await notify(booking.customer, 'deposit_processed', 'Deposit inspection complete',
      processedDeposit.status === 'refund_pending'
        ? `Deposit refund of ${processedDeposit.refundAmount} is being processed.`
        : `Deposit refund: ${processedDeposit.refundAmount}.`,
      { bookingId: booking.id });
    return sendSuccess(res, processedDeposit.status === 'refund_pending'
      ? 'Return inspected; payment provider is processing the deposit refund'
      : 'Return inspected; deposit disposition is complete', { booking, deposit: disposition.deposit });
  })
);

module.exports = router;
