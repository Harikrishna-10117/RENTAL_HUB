const express = require('express');
const { body, param } = require('express-validator');
const Cart = require('../models/Cart');
const Equipment = require('../models/Equipment');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, AppError, sendSuccess } = require('../utils/api');
const { validateDates, assertAvailable, withReservationLocks } = require('../services/availability');
const { resolveLegacyEquipmentIds } = require('../services/inventory');
const idempotency = require('../middleware/idempotency');
const { bookingDateRange } = require('../validators');

const router = express.Router();
router.use(protect, allowRoles('customer'));

function presentCart(cart) {
  const items = (cart?.items ?? []).filter((line) => line.equipment).map((line) => {
    const rentalDays = Math.max(1, Math.ceil((new Date(line.endDate) - new Date(line.startDate)) / 86400000));
    const quantity = line.quantity || 1;
    const rentalSubtotal = line.equipment.dailyRate * rentalDays * quantity;
    const depositAmount = line.equipment.depositAmount * quantity;
    return {
      id: line._id,
      equipment: line.equipment,
      quantity,
      startDate: line.startDate,
      endDate: line.endDate,
      rentalDays,
      rentalSubtotal,
      depositAmount,
      totalAmount: rentalSubtotal + depositAmount
    };
  });
  return {
    id: cart?._id ?? null,
    items,
    subtotal: items.reduce((total, item) => total + item.rentalSubtotal, 0),
    depositAmount: items.reduce((total, item) => total + item.depositAmount, 0),
    totalAmount: items.reduce((total, item) => total + item.totalAmount, 0),
    currency: 'INR'
  };
}

async function loadCart(customerId) {
  return Cart.findOneAndUpdate(
    { customer: customerId },
    { $setOnInsert: { customer: customerId, items: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).populate('items.equipment', 'name dailyRate depositAmount currency images location status active quantity');
}

router.get('/', asyncHandler(async (req, res) => {
  const cart = await loadCart(req.user.id);
  return sendSuccess(res, 'Cart loaded', { cart: presentCart(cart) });
}));

router.post('/items',
  idempotency,
  body('equipmentId').isMongoId().withMessage('equipmentId must be valid'),
  body('quantity').optional().isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
  ...bookingDateRange,
  validate,
  asyncHandler(async (req, res) => {
    const { start, end } = validateDates(req.body.startDate, req.body.endDate);
    const [equipmentId] = await resolveLegacyEquipmentIds([req.body.equipmentId]);
    await withReservationLocks([equipmentId], async () => {
      const equipment = await Equipment.findOne({ _id: equipmentId, active: true, status: 'available' });
      if (!equipment) throw new AppError('Equipment is unavailable', 409, 'ITEM_UNAVAILABLE');
      if (String(equipment.owner) === String(req.user.id)) {
        throw new AppError('You cannot add your own equipment to the cart', 403, 'FORBIDDEN');
      }
      await assertAvailable([equipment._id], start, end, undefined, [{ equipment: equipment._id, quantity: Number(req.body.quantity || 1) }]);
    });

    const cart = await Cart.findOneAndUpdate(
      { customer: req.user.id },
      { $setOnInsert: { customer: req.user.id, items: [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const existing = cart.items.find((item) => String(item.equipment) === String(equipmentId));
    if (existing) {
      existing.startDate = start;
      existing.endDate = end;
      existing.quantity = Number(req.body.quantity || existing.quantity || 1);
    } else {
      cart.items.push({ equipment: equipmentId, quantity: Number(req.body.quantity || 1), startDate: start, endDate: end });
    }
    await cart.save();
    await cart.populate('items.equipment', 'name dailyRate depositAmount currency images location status active quantity');
    return sendSuccess(res, 'Equipment added to cart', { cart: presentCart(cart) }, 201);
  })
);

router.patch('/items/:equipmentId',
  idempotency,
  param('equipmentId').isMongoId().withMessage('equipmentId must be valid'),
  body('quantity').optional().isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000'),
  ...bookingDateRange,
  validate,
  asyncHandler(async (req, res) => {
    const { start, end } = validateDates(req.body.startDate, req.body.endDate);
    const [equipmentId] = await resolveLegacyEquipmentIds([req.params.equipmentId]);
    const cart = await Cart.findOne({ customer: req.user.id });
    const item = cart?.items.find((line) => String(line.equipment) === String(equipmentId));
    if (!item) throw new AppError('Cart item not found', 404, 'NOT_FOUND');
    await withReservationLocks([equipmentId], async () => {
      const equipment = await Equipment.findOne({ _id: equipmentId, active: true, status: 'available' });
      if (!equipment) throw new AppError('Equipment is unavailable', 409, 'ITEM_UNAVAILABLE');
      const quantity = Number(req.body.quantity ?? item.quantity ?? 1);
      await assertAvailable([equipment._id], start, end, undefined, [{ equipment: equipment._id, quantity }]);
      item.quantity = quantity;
    });
    item.startDate = start;
    item.endDate = end;
    await cart.save();
    await cart.populate('items.equipment', 'name dailyRate depositAmount currency images location status active quantity');
    return sendSuccess(res, 'Cart dates updated', { cart: presentCart(cart) });
  })
);

router.delete('/items/:equipmentId',
  idempotency,
  param('equipmentId').isMongoId().withMessage('equipmentId must be valid'),
  validate,
  asyncHandler(async (req, res) => {
    const [equipmentId] = await resolveLegacyEquipmentIds([req.params.equipmentId]);
    const cart = await Cart.findOne({ customer: req.user.id });
    if (!cart) throw new AppError('Cart item not found', 404, 'NOT_FOUND');
    const initialLength = cart.items.length;
    cart.items = cart.items.filter((item) => String(item.equipment) !== String(equipmentId));
    if (cart.items.length === initialLength) throw new AppError('Cart item not found', 404, 'NOT_FOUND');
    await cart.save();
    await cart.populate('items.equipment', 'name dailyRate depositAmount currency images location status active');
    return sendSuccess(res, 'Equipment removed from cart', { cart: presentCart(cart) });
  })
);

router.delete('/items', idempotency, asyncHandler(async (req, res) => {
  const cart = await Cart.findOneAndUpdate(
    { customer: req.user.id },
    { $set: { items: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return sendSuccess(res, 'Cart cleared', { cart: presentCart(cart) });
}));

module.exports = router;