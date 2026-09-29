const express = require('express');
const Category = require('../models/Category');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
const Review = require('../models/Review');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { objectId, dateRange } = require('../utils/validation');
const { assertAvailable, validateDates } = require('../services/availability');
const { SearchProvider } = require('../services/search');
const { toLegacyAsset } = require('../services/inventory');

const router = express.Router();

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await Category.find({ active: true }).sort('name');
  return sendSuccess(res, 'Categories', categories);
}));

router.get('/equipment', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
  const result = await SearchProvider.query({
    page,
    limit,
    q: req.query.q,
    category: req.query.category,
    city: req.query.city ?? req.query.location,
    brand: req.query.brand,
    condition: req.query.condition,
    minRate: req.query.minRate,
    maxRate: req.query.maxRate,
    sort: req.query.sort
  });
  const items = await Promise.all(result.items.map(toLegacyAsset));
  if (req.query.startDate && req.query.endDate) {
    const { start, end } = validateDates(req.query.startDate, req.query.endDate);
    const availability = await Promise.all(items.map(async (item) => {
      try {
        await assertAvailable([item._id], start, end);
        return true;
      } catch (error) {
        if (error.errorCode !== 'DATES_UNAVAILABLE') throw error;
        return false;
      }
    }));
    const free = items.filter((_, index) => availability[index]);
    return sendSuccess(res, 'Available equipment', {
      items: free, pagination: { ...result.pagination, total: free.length, pages: Math.ceil(free.length / limit) }
    });
  }
  return sendSuccess(res, 'Equipment', {
    items, pagination: result.pagination
  });
}));

router.get('/equipment/:id', objectId(), validate, asyncHandler(async (req, res) => {
  let equipment = await Equipment.findOne({ _id: req.params.id, active: true })
    .populate('category', 'name slug names aliases')
    .populate('owner', 'name ownerVerified')
    .lean();
  if (!equipment) {
    const asset = await EquipmentAsset.findOne({
      active: true,
      $or: [{ _id: req.params.id }, { assetId: req.params.id }]
    }).populate({ path: 'equipmentType', populate: { path: 'category', select: 'name slug' } })
      .populate('owner', 'name ownerVerified').lean();
    if (asset) equipment = await toLegacyAsset(asset);
  }
  if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const reviews = await Review.find({ equipment: equipment._id })
    .populate('customer', 'name')
    .sort({ createdAt: -1 }).limit(20);
  return sendSuccess(res, 'Equipment details', { ...equipment, reviews });
}));

router.get('/equipment/:id/events', protect, objectId(), validate, asyncHandler(async (req, res) => {
  const equipment = await Equipment.findById(req.params.id);
  if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const { allowRoles } = require('../middleware/auth');
  if (equipment.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new AppError('Only the item owner or an admin can view its lifecycle', 403, 'FORBIDDEN');
  }
  const EquipmentEvent = require('../models/EquipmentEvent');
  const events = await EquipmentEvent.find({ equipment: equipment._id }).populate('actor', 'name role').sort({ createdAt: -1 });
  return sendSuccess(res, 'Equipment lifecycle events', events);
}));

module.exports = router;
