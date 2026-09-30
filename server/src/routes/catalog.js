const express = require('express');
const Category = require('../models/Category');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
const Review = require('../models/Review');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { objectId } = require('../validators');
const { SearchProvider } = require('../services/search');
const { toLegacyAsset } = require('../services/inventory');
const { getCategorySummaries, getCategoryProducts } = require('../services/catalog');

const router = express.Router();

function presentPublicEquipment(item) {
  const category = item.category && typeof item.category === 'object'
    ? { _id: item.category._id, name: item.category.name, slug: item.category.slug, names: item.category.names }
    : item.category;
  const owner = item.owner && typeof item.owner === 'object'
    ? {
      _id: item.owner._id,
      name: item.owner.name,
      ownerVerified: item.owner.ownerVerified === true,
      verificationStatus: item.owner.ownerVerified === true ? 'verified'
        : item.owner.verificationStatus === 'rejected' ? 'rejected' : 'pending'
    }
    : null;
  const location = typeof item.location === 'string'
    ? { city: item.location, region: '' }
    : {
      city: item.location?.city || '',
      region: item.location?.region || item.location?.state || ''
    };
  return {
    _id: item._id,
    id: item._id,
    owner,
    category,
    name: item.name,
    description: item.description,
    images: item.images || [],
    brand: item.brand || '',
    model: item.model || '',
    manufacturingYear: item.manufacturingYear ?? null,
    specifications: item.specifications || [],
    dimensions: item.dimensions || {},
    weight: item.weight || {},
    operatingRequirements: item.operatingRequirements || {},
    operatorRequirement: item.operatorRequirement || {},
    transportRequirements: item.transportRequirements || {},
    dailyRate: item.dailyRate,
    quantity: item.quantity || 1,
    replacementValue: item.replacementValue,
    depositAmount: item.depositAmount,
    currency: item.currency || 'INR',
    condition: item.condition,
    status: item.status,
    verificationStatus: item.verificationStatus || 'pending',
    active: item.active !== false,
    location
  };
}

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await Category.find({ active: true }).sort('name');
  return sendSuccess(res, 'Categories', await getCategorySummaries(categories));
}));

router.get('/categories/:slug', asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: String(req.params.slug).toLowerCase(), active: true });
  if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
  const [summary] = await getCategorySummaries([category]);
  const products = await getCategoryProducts(category._id);
  return sendSuccess(res, 'Category catalog', { ...summary, products });
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
    sort: req.query.sort,
    equipmentType: req.query.equipmentType,
    operatorRequired: req.query.operatorRequired,
    transportRequired: req.query.transportRequired,
    startDate: req.query.startDate,
    endDate: req.query.endDate
  });
  const items = await Promise.all(result.items.map(toLegacyAsset));
  return sendSuccess(res, 'Equipment', {
    items: items.map(presentPublicEquipment), pagination: result.pagination
  });
}));

router.get('/equipment/:id', objectId(), validate, asyncHandler(async (req, res) => {
  let equipment = await Equipment.findOne({ _id: req.params.id, active: true, status: 'available' })
    .populate('category', 'name slug names aliases active')
    .populate('owner', 'name ownerVerified verificationStatus')
    .lean();
  if (equipment && !equipment.category?.active) equipment = null;
  if (!equipment) {
    const asset = await EquipmentAsset.findOne({
      active: true,
      status: 'available',
      $or: [{ _id: req.params.id }, { assetId: req.params.id }]
    }).populate({ path: 'equipmentType', match: { active: true }, populate: { path: 'category', match: { active: true }, select: 'name slug active' } })
      .populate('owner', 'name ownerVerified verificationStatus').lean();
    if (asset?.equipmentType?.category) equipment = await toLegacyAsset(asset);
  }
  if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
  const reviews = await Review.find({ equipment: equipment._id })
    .populate('customer', 'name')
    .sort({ createdAt: -1 }).limit(20);
  return sendSuccess(res, 'Equipment details', { ...presentPublicEquipment(equipment), reviews });
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
