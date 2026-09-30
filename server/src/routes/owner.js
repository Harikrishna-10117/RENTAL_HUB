const express = require('express');
const User = require('../models/User');
const Equipment = require('../models/Equipment');
const Category = require('../models/Category');
const Booking = require('../models/Booking');
const Delivery = require('../models/Delivery');
const Deposit = require('../models/Deposit');
const Payment = require('../models/Payment');
const EquipmentEvent = require('../models/EquipmentEvent');
const Rental = require('../models/Rental');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const DeliveryConditionReport = require('../models/DeliveryConditionReport');
const ReturnConditionReport = require('../models/ReturnConditionReport');
const Review = require('../models/Review');
const EquipmentBlockPeriod = require('../models/EquipmentBlockPeriod');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../validators');
const idempotency = require('../middleware/idempotency');
const notify = require('../utils/notifications');
const Package = require('../models/Package');
const SwapRequest = require('../models/SwapRequest');
const { syncAssetForLegacy, setAssetsLifecycle, inspectAssets } = require('../services/inventory');
const { settleBookingCancellation, settleDepositDisposition } = require('../services/bookingFinance');
const { validateDates, assertAvailable, withReservationLocks } = require('../services/availability');

const router = express.Router();
router.use((req, res, next) => {
  const equipmentPath = /^\/equipment(\/|$)/.test(req.path);
  const protectedPath = req.baseUrl.endsWith('/owner') ||
    equipmentPath || /^\/(bookings)(\/|$)/.test(req.path) || req.path === '/owner/swaps';
  if (!protectedPath) return next();
  const roles = equipmentPath
    ? req.baseUrl.endsWith('/admin') ? ['admin'] : ['owner', 'admin']
    : ['owner'];
  return protect(req, res, () => allowRoles(...roles)(req, res, next));
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
    model: bodyData.model || '',
    manufacturingYear: bodyData.manufacturingYear === '' || bodyData.manufacturingYear === undefined
      ? null : bodyData.manufacturingYear === null ? null : Number(bodyData.manufacturingYear),
    specifications: bodyData.specifications || [],
    dimensions: bodyData.dimensions || {},
    weight: bodyData.weight || {},
    operatingRequirements: bodyData.operatingRequirements || {},
    operatorRequirement: bodyData.operatorRequirement || {},
    transportRequirements: bodyData.transportRequirements || {},
    dailyRate,
    replacementValue: Number(bodyData.replacementValue ?? dailyRate * 10),
    depositAmount: Number(bodyData.depositAmount ?? 0),
    quantity: Number(bodyData.quantity ?? 1),
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
  const category = String(categoryInput).match(/^[a-f\d]{24}$/i)
    ? await Category.findById(categoryInput)
    : await Category.findOne({ $or: [{ name: new RegExp(`^${String(categoryInput).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { slug: String(categoryInput).toLowerCase() }] });
  if (category && !category.active) throw new AppError('Equipment must use an active category', 409, 'CATEGORY_INACTIVE');
  return category;
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

function validImageReference(value) {
  if (/^\/api\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(value)) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const equipmentValidators = [
  body('ownerId').optional().isMongoId(),
  body('verificationStatus').optional().isIn(['pending', 'verified', 'rejected']),
  body('category').notEmpty(),
  body('name').trim().notEmpty().isLength({ max: 140 }),
  body('description').trim().notEmpty().isLength({ max: 5000 }),
  body('dailyRate').optional().isFloat({ min: 0 }),
  body('pricePerDay').optional().isFloat({ min: 0 }),
  body('price').optional().isFloat({ min: 0 }),
  body().custom((value) => [value.dailyRate, value.pricePerDay, value.price].some((rate) => Number.isFinite(Number(rate)) && Number(rate) >= 0)).withMessage('A non-negative dailyRate is required'),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('quantity').optional().isInt({ min: 1, max: 1000 }),
  body('manufacturingYear').optional({ nullable: true }).isInt({ min: 1900, max: new Date().getFullYear() + 1 }),
  body('model').optional().isString().isLength({ max: 100 }),
  body('brand').optional().isString().isLength({ max: 100 }),
  body('specifications').optional().isArray({ max: 40 }),
  body('specifications.*.key').optional().trim().notEmpty().isLength({ max: 80 }),
  body('specifications.*.value').optional().trim().notEmpty().isLength({ max: 300 }),
  body('specifications.*.unit').optional().isString().isLength({ max: 30 }),
  body('dimensions').optional().isObject({ strict: true }),
  ...['length', 'width', 'height'].map((field) => body(`dimensions.${field}`).optional().isFloat({ min: 0 })),
  body('dimensions.unit').optional().isIn(['mm', 'cm', 'm', 'in', 'ft']),
  body('weight').optional().isObject({ strict: true }),
  body('weight.value').optional().isFloat({ min: 0 }),
  body('weight.unit').optional().isIn(['g', 'kg', 'lb']),
  ...['operatingRequirements', 'operatorRequirement', 'transportRequirements'].flatMap((field) => [
    body(field).optional().isObject({ strict: true }),
    body(`${field}.required`).optional().isBoolean(),
    body(`${field}.method`).optional().isString().isLength({ max: 100 }),
    body(`${field}.notes`).optional().isString().isLength({ max: 1000 })
  ]),
  body('location').custom((value) => typeof value === 'string' ? Boolean(value.trim()) : Boolean(value?.city?.trim())).withMessage('Location city is required'),
  body('availability').optional().isIn(['active', 'inactive', 'available', 'unavailable']),
  body('images').optional().isArray({ max: 20 }),
  body('images.*').optional().custom(validImageReference).isLength({ max: 2048 }),
  body('imageUrl').optional({ checkFalsy: true }).isURL(),
  body('condition').optional().isIn(['new', 'excellent', 'good', 'fair']),
  body('status').optional().isIn(['available', 'unavailable', 'maintenance']),
  body('swapTypes').optional().isArray()
];

router.get('/equipment', asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { owner: req.user.id };
  const items = await Equipment.find(filter).populate('category', 'name slug names aliases').sort({ createdAt: -1 });
  return sendSuccess(res, 'Your equipment', items.map(presentEquipment));
}));

router.get('/analytics', protect, allowRoles('owner'), asyncHandler(async (req, res) => {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 90 * 86400000);
  const [equipment, rentals, reviews, scheduledDeliveries, maintenanceBlocks] = await Promise.all([
    Equipment.find({ owner: req.user.id, active: true }).select('_id name quantity dailyRate').lean(),
    Rental.find({ owner: req.user.id, startDate: { $lt: periodEnd }, endDate: { $gt: periodStart } })
      .select('equipment equipmentQuantities startDate endDate status pricing rentalDays').lean(),
    Review.find({ owner: req.user.id }).select('rating').lean(),
    Delivery.find({ owner: req.user.id, scheduledAt: { $ne: null }, deliveredAt: { $ne: null } })
      .select('scheduledAt deliveredAt').lean(),
    EquipmentBlockPeriod.find({
      active: true, type: 'MAINTENANCE', startDate: { $lt: periodEnd }, endDate: { $gt: periodStart },
      equipment: { $in: await Equipment.find({ owner: req.user.id, active: true }).distinct('_id') }
    }).select('equipment quantity startDate endDate').lean()
  ]);
  const completedRentals = rentals.filter((rental) => rental.status === 'COMPLETED');
  const cancelledRentals = rentals.filter((rental) => rental.status === 'CANCELLED');
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const utilization = equipment.map((item) => {
    const stock = item.quantity || 1;
    const intervalDays = (start, end) => Math.max(0,
      Math.ceil((Math.min(new Date(end).getTime(), periodEnd.getTime()) - Math.max(new Date(start).getTime(), periodStart.getTime())) / 86400000)
    );
    const rentedAssetDays = rentals.reduce((total, rental) => {
      if (!rental.equipment.some((id) => String(id) === String(item._id))) return total;
      const line = rental.equipmentQuantities?.find((entry) => String(entry.equipment) === String(item._id));
      return total + intervalDays(rental.startDate, rental.endDate) * (line?.quantity || 1);
    }, 0);
    const maintenanceAssetDays = maintenanceBlocks.reduce((total, block) => (
      String(block.equipment) === String(item._id)
        ? total + intervalDays(block.startDate, block.endDate) * (block.quantity || stock)
        : total
    ), 0);
    const availableAssetDays = Math.max(0, 90 * stock - maintenanceAssetDays);
    return {
      equipmentId: item._id,
      name: item.name,
      rentedAssetDays,
      maintenanceAssetDays,
      availableAssetDays,
      utilizationPercent: availableAssetDays ? Math.round((rentedAssetDays / availableAssetDays) * 10000) / 100 : null
    };
  });
  const dailyRates = completedRentals.filter((rental) => rental.equipment.length === 1)
    .map((rental) => {
      const quantity = rental.equipmentQuantities?.[0]?.quantity || 1;
      return rental.pricing.rentalSubtotal / rental.rentalDays / quantity;
    }).filter((rate) => Number.isFinite(rate) && rate > 0);
  const averageRating = reviews.length
    ? Math.round(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length * 100) / 100
    : null;
  const onTimeDeliveries = scheduledDeliveries.filter((delivery) => delivery.deliveredAt <= delivery.scheduledAt).length;
  return sendSuccess(res, 'Owner analytics', {
    periodStart,
    periodEnd,
    rentals: {
      total: rentals.length,
      completed: completedRentals.length,
      cancelled: cancelledRentals.length,
      cancellationRate: rentals.length ? Math.round(cancelledRentals.length / rentals.length * 10000) / 100 : 0
    },
    reviews: { count: reviews.length, averageRating, message: reviews.length ? null : 'Not enough rental history.' },
    delivery: {
      scheduledCount: scheduledDeliveries.length,
      onTimeCount: onTimeDeliveries,
      onTimeRate: scheduledDeliveries.length ? Math.round(onTimeDeliveries / scheduledDeliveries.length * 10000) / 100 : null
    },
    utilization,
    pricingRecommendations: equipment.map((item) => {
      const rates = completedRentals.filter((rental) => rental.equipment.length === 1 && String(rental.equipment[0]) === String(item._id))
        .map((rental) => rental.pricing.rentalSubtotal / rental.rentalDays / (rental.equipmentQuantities?.[0]?.quantity || 1))
        .filter((rate) => Number.isFinite(rate) && rate > 0);
      return rates.length >= 10
        ? { equipmentId: item._id, available: true, recommendedDailyRate: median(rates), currency: 'INR', basis: `${rates.length} completed rentals` }
        : { equipmentId: item._id, available: false, message: 'Not enough data for pricing recommendation.' };
    })
  });
}));

router.get('/equipment/:id/passport', objectId(), validate, asyncHandler(async (req, res) => {
  const equipment = await Equipment.findOne({
    _id: req.params.id,
    ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
  }).populate('category', 'name slug names').lean();
  if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const [rentals, deliveryInspections, returnInspections, maintenance, reviews, events] = await Promise.all([
    Rental.find({ equipment: equipment._id })
      .select('_id booking startDate endDate rentalDays pricing status paymentStatus createdAt updatedAt')
      .sort({ startDate: -1 }).lean(),
    DeliveryConditionReport.find({ equipment: equipment._id })
      .select('delivery rental overallCondition checklist existingDamage missingComponents accessoriesIncluded attachmentsIncluded usageReading notes recordedAt photos')
      .sort({ recordedAt: -1 }).lean(),
    ReturnConditionReport.find({ equipment: equipment._id })
      .select('returnRecord rental delivery condition conditionAtDelivery checklist damage evidenceUrls inspectedAt')
      .sort({ inspectedAt: -1 }).lean(),
    MaintenanceRecord.find({ equipment: equipment._id })
      .select('type serviceDate startDate endDate meterReading notes cost nextServiceDate status createdAt')
      .sort({ startDate: -1 }).lean(),
    Review.find({ equipment: equipment._id })
      .select('rating comment createdAt').sort({ createdAt: -1 }).lean(),
    EquipmentEvent.find({ equipment: equipment._id })
      .select('type details createdAt').sort({ createdAt: -1 }).lean()
  ]);
  return sendSuccess(res, 'Equipment passport', {
    equipment: {
      id: equipment._id,
      assetId: equipment.assetId || '',
      name: equipment.name,
      category: equipment.category,
      brand: equipment.brand || '',
      model: equipment.model || '',
      manufacturingYear: equipment.manufacturingYear,
      specifications: equipment.specifications || [],
      condition: equipment.condition,
      location: equipment.location,
      images: equipment.images || []
    },
    rentalHistory: rentals,
    deliveryInspections,
    returnInspections,
    maintenanceHistory: maintenance,
    reviews,
    lifecycleEvents: events
  });
}));

router.post('/equipment', ...equipmentValidators, validate, asyncHandler(async (req, res) => {
  if (req.user.role === 'owner' && !req.user.ownerVerified) {
    throw new AppError('Your owner account must be verified before listing equipment', 403, 'OWNER_NOT_VERIFIED');
  }
  if (req.user.role !== 'admin' && (req.body.ownerId !== undefined || req.body.owner !== undefined || req.body.verificationStatus !== undefined)) {
    throw new AppError('Only administrators can set an equipment owner or verification status', 403, 'FORBIDDEN');
  }
  const category = await resolveCategory(req.body.category);
  if (!category) throw new AppError('Category not found', 400, 'INVALID_CATEGORY');
  const owner = req.user.role === 'admin'
    ? await User.findOne({ _id: req.body.ownerId, role: 'owner' })
    : req.user;
  if (!owner) throw new AppError('A valid owner account is required', 400, 'INVALID_OWNER');
  const item = await Equipment.create({
    ...equipmentInput(req.body),
    category: category._id,
    owner: owner._id,
    ...(req.user.role === 'admin' && req.body.verificationStatus ? { verificationStatus: req.body.verificationStatus } : {})
  });
  await syncAssetForLegacy(item);
  return sendSuccess(res, 'Equipment created', presentEquipment(item), 201);
}));

router.get('/equipment/:id/blocks', objectId('id'), validate, asyncHandler(async (req, res) => {
  const equipment = await Equipment.findOne({
    _id: req.params.id,
    ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
  });
  if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const periods = await EquipmentBlockPeriod.find({ equipment: equipment._id, active: true }).sort({ startDate: 1 });
  return sendSuccess(res, 'Equipment block periods', periods);
}));

router.post('/equipment/:id/blocks', objectId('id'),
  body('startDate').notEmpty().isISO8601().withMessage('A valid block start date is required'),
  body('endDate').notEmpty().isISO8601().withMessage('A valid block end date is required'),
  body('quantity').optional().isInt({ min: 1, max: 1000 }),
  body('type').isIn(['MAINTENANCE', 'BLOCKED']),
  body('reason').optional().isString().isLength({ max: 500 }),
  validate,
  asyncHandler(async (req, res) => {
    const { start, end } = validateDates(req.body.startDate, req.body.endDate);
    const equipment = await Equipment.findOne({
      _id: req.params.id,
      ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    const quantity = req.body.quantity === undefined ? equipment.quantity : Number(req.body.quantity);
    if (quantity > equipment.quantity) throw new AppError('Blocked quantity exceeds listed stock', 400, 'INVALID_BLOCK_QUANTITY');
    const period = await withReservationLocks([equipment._id], async () => {
      await assertAvailable([equipment._id], start, end, undefined, [{ equipment: equipment._id, quantity }]);
      return EquipmentBlockPeriod.create({
        equipment: equipment._id,
        createdBy: req.user.id,
        startDate: start,
        endDate: end,
        quantity: req.body.quantity === undefined ? null : quantity,
        type: req.body.type,
        reason: req.body.reason || ''
      });
    });
    return sendSuccess(res, 'Equipment block period created', period, 201);
  })
);

router.delete('/equipment/:id/blocks/:blockId', objectId('id'), objectId('blockId'), idempotency, validate,
  asyncHandler(async (req, res) => {
    const equipment = await Equipment.findOne({
      _id: req.params.id,
      ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    const period = await EquipmentBlockPeriod.findOneAndUpdate(
      { _id: req.params.blockId, equipment: equipment._id, active: true },
      { $set: { active: false } },
      { new: true }
    );
    if (!period) throw new AppError('Equipment block period not found', 404, 'NOT_FOUND');
    return sendSuccess(res, 'Equipment block period released', period);
  })
);

router.get('/equipment/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const item = await Equipment.findOne({
    _id: req.params.id, ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
  }).populate('category', 'name slug names aliases');
  if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  return sendSuccess(res, 'Your equipment', presentEquipment(item));
}));

const optionalEquipmentValidators = [
  body('ownerId').not().exists().withMessage('Equipment ownership cannot be changed'),
  body('category').optional().notEmpty(),
  body('name').optional().trim().notEmpty().isLength({ max: 140 }),
  body('description').optional().trim().notEmpty().isLength({ max: 5000 }),
  body('dailyRate').optional().isFloat({ min: 0 }),
  body('pricePerDay').optional().isFloat({ min: 0 }),
  body('price').optional().isFloat({ min: 0 }),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('quantity').optional().isInt({ min: 1, max: 1000 }),
  body('manufacturingYear').optional({ nullable: true }).isInt({ min: 1900, max: new Date().getFullYear() + 1 }),
  body('model').optional().isString().isLength({ max: 100 }),
  body('brand').optional().isString().isLength({ max: 100 }),
  body('specifications').optional().isArray({ max: 40 }),
  body('specifications.*.key').optional().trim().notEmpty().isLength({ max: 80 }),
  body('specifications.*.value').optional().trim().notEmpty().isLength({ max: 300 }),
  body('specifications.*.unit').optional().isString().isLength({ max: 30 }),
  body('dimensions').optional().isObject({ strict: true }),
  ...['length', 'width', 'height'].map((field) => body(`dimensions.${field}`).optional().isFloat({ min: 0 })),
  body('dimensions.unit').optional().isIn(['mm', 'cm', 'm', 'in', 'ft']),
  body('weight').optional().isObject({ strict: true }),
  body('weight.value').optional().isFloat({ min: 0 }),
  body('weight.unit').optional().isIn(['g', 'kg', 'lb']),
  ...['operatingRequirements', 'operatorRequirement', 'transportRequirements'].flatMap((field) => [
    body(field).optional().isObject({ strict: true }),
    body(`${field}.required`).optional().isBoolean(),
    body(`${field}.method`).optional().isString().isLength({ max: 100 }),
    body(`${field}.notes`).optional().isString().isLength({ max: 1000 })
  ]),
  body('verificationStatus').optional().isIn(['pending', 'verified', 'rejected']),
  body('location').optional().custom((value) => typeof value === 'string' ? Boolean(value.trim()) : Boolean(value?.city?.trim())),
  body('availability').optional().isIn(['active', 'inactive', 'available', 'unavailable']),
  body('status').optional().isIn(['active', 'inactive', 'available', 'unavailable', 'maintenance']),
  body('images').optional().isArray({ max: 20 }),
  body('images.*').optional().custom(validImageReference).isLength({ max: 2048 }),
  body('imageUrl').optional({ checkFalsy: true }).isURL(),
  body('condition').optional().isIn(['new', 'excellent', 'good', 'fair']),
  body('swapTypes').optional().isArray()
];

router.patch('/equipment/:id', objectId(), ...optionalEquipmentValidators, validate,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin' && req.body.verificationStatus !== undefined) {
      throw new AppError('Only administrators can change equipment verification status', 403, 'FORBIDDEN');
    }
    const item = await Equipment.findOne({
      _id: req.params.id, ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    if (item.reservationLock) throw new AppError('Item is being reserved; retry shortly', 409, 'RESERVATION_BUSY');
    const input = equipmentInput({ ...item.toObject(), ...req.body });
    const allowed = [
      'name', 'description', 'brand', 'model', 'manufacturingYear', 'specifications', 'dimensions', 'weight',
      'operatingRequirements', 'operatorRequirement', 'transportRequirements',
      'dailyRate', 'replacementValue', 'depositAmount', 'quantity', 'location', 'images', 'condition', 'swapTypes', 'status'
    ];
    for (const field of allowed) if (req.body[field] !== undefined || (field === 'status' && req.body.availability !== undefined)) item[field] = input[field];
    if (req.user.role === 'admin' && req.body.verificationStatus !== undefined) item.verificationStatus = req.body.verificationStatus;
    if (req.body.imageUrl !== undefined) item.images = req.body.imageUrl ? [req.body.imageUrl] : [];
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
  const item = await Equipment.findOne({
    _id: req.params.id, ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
  });
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
    if (req.user.role !== 'admin' && req.body.verificationStatus !== undefined) {
      throw new AppError('Only administrators can change equipment verification status', 403, 'FORBIDDEN');
    }
    const item = await Equipment.findOne({
      _id: req.params.id, ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!item) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    if (item.reservationLock) throw new AppError('Item is being reserved; retry shortly', 409, 'RESERVATION_BUSY');
    const input = equipmentInput({ ...item.toObject(), ...req.body });
    for (const field of [
      'name', 'description', 'brand', 'model', 'manufacturingYear', 'specifications', 'dimensions', 'weight',
      'operatingRequirements', 'operatorRequirement', 'transportRequirements',
      'dailyRate', 'replacementValue', 'depositAmount', 'location', 'images', 'condition', 'swapTypes', 'status'
    ]) {
      if (req.body[field] !== undefined || (field === 'status' && req.body.availability !== undefined)) item[field] = input[field];
    }
    if (req.user.role === 'admin' && req.body.verificationStatus !== undefined) item.verificationStatus = req.body.verificationStatus;
    if (req.body.imageUrl !== undefined) item.images = req.body.imageUrl ? [req.body.imageUrl] : [];
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
