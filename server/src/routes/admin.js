const express = require('express');
const User = require('../models/User');
const Category = require('../models/Category');
const EquipmentType = require('../models/EquipmentType');
const EquipmentAsset = require('../models/EquipmentAsset');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../validators');
const notify = require('../utils/notifications');
const { getCategorySummaries } = require('../services/catalog');
const { normalizeSearchText } = require('../utils/searchText');

const router = express.Router();
router.use(protect, allowRoles('admin'));

router.get('/owners', asyncHandler(async (req, res) => {
  const filter = { role: 'owner' };
  if (req.query.status && req.query.status !== 'all') {
    if (!['pending', 'verified', 'rejected'].includes(req.query.status)) {
      throw new AppError('status must be pending, verified, rejected, or all', 400, 'VALIDATION_ERROR');
    }
    if (req.query.status === 'verified') filter.ownerVerified = true;
    else if (req.query.status === 'pending') filter.ownerVerified = false;
    filter.verificationStatus = req.query.status;
  }
  const owners = await User.find(filter).select('name email phone ownerVerified verificationStatus createdAt').sort({ createdAt: -1 });
  for (const owner of owners) {
    if (owner.ownerVerified) owner.verificationStatus = 'verified';
  }
  return sendSuccess(res, 'Owner verification queue', owners);
}));

router.patch('/owners/:id/verification',
  objectId(),
  body('verified').optional().isBoolean(),
  body('status').optional().isIn(['pending', 'verified', 'rejected']),
  validate,
  asyncHandler(async (req, res) => {
    const status = req.body.status || (req.body.verified ? 'verified' : req.body.verified === false ? 'rejected' : null);
    if (!status) throw new AppError('Provide status (pending, verified, rejected) or verified (boolean)', 400, 'VALIDATION_ERROR');
    const verified = status === 'verified';
    const owner = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'owner' },
      { $set: { ownerVerified: verified, verificationStatus: status } },
      { new: true }
    ).select('name email ownerVerified');
    if (!owner) throw new AppError('Owner account not found', 404, 'NOT_FOUND');
    await notify(owner._id, verified ? 'owner_verified' : 'owner_verification_revoked',
      verified ? 'Owner verified' : status === 'rejected' ? 'Verification declined' : 'Verification revoked',
      verified ? 'Your account may now list equipment.' : 'Your owner verification is no longer active.');
    return sendSuccess(res, 'Owner verification updated', owner);
  })
);

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await Category.find().sort('name');
  return sendSuccess(res, 'Marketplace categories', await getCategorySummaries(categories));
}));

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function findCategory(value) {
  const isId = /^[a-f\d]{24}$/i.test(String(value));
  return Category.findOne(isId ? { _id: value } : { $or: [{ slug: slugify(value) }, { name: String(value).trim() }] });
}

router.post('/categories',
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('slug').optional().trim().isLength({ min: 1, max: 120 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('names').optional().isArray({ max: 3 }),
  body('names.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('names.*.value').optional().isString().trim().isLength({ max: 100 }),
  body('descriptions').optional().isArray({ max: 3 }),
  body('descriptions.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('descriptions.*.value').optional().isString().isLength({ max: 1000 }),
  body('image').optional().isURL({ require_protocol: true }).isLength({ max: 2048 }),
  validate,
  asyncHandler(async (req, res) => {
    const slug = req.body.slug || slugify(req.body.name);
    if (!slug) throw new AppError('A category slug is required for this name', 400, 'VALIDATION_ERROR');
    const category = await Category.create({
      name: req.body.name.trim(), slug, description: req.body.description || '',
      names: req.body.names || [{ lang: 'en', value: req.body.name.trim() }],
      aliases: (req.body.names || []).map((entry) => entry.value),
      descriptions: req.body.descriptions || [], image: req.body.image || ''
    });
    return sendSuccess(res, 'Category created', category, 201);
  })
);

router.patch('/categories/:id',
  objectId(),
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('slug').optional().trim().isLength({ min: 1, max: 120 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('names').optional().isArray({ max: 3 }),
  body('names.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('names.*.value').optional().isString().trim().isLength({ max: 100 }),
  body('descriptions').optional().isArray({ max: 3 }),
  body('descriptions.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('descriptions.*.value').optional().isString().isLength({ max: 1000 }),
  body('image').optional().isURL({ require_protocol: true }).isLength({ max: 2048 }),
  body('active').optional().isBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    if (req.body.name !== undefined) {
      category.name = req.body.name.trim();
      category.slug = req.body.slug || slugify(category.name);
      if (!category.slug) throw new AppError('A category slug is required for this name', 400, 'VALIDATION_ERROR');
    }
    if (req.body.slug !== undefined) category.slug = req.body.slug;
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.names !== undefined) {
      category.names = req.body.names;
      category.aliases = [...new Set([...category.aliases, ...req.body.names.map((entry) => entry.value)])];
    } else if (req.body.name !== undefined) {
      const englishName = category.names.find((entry) => entry.lang === 'en');
      if (englishName) englishName.value = category.name;
      else category.names.push({ lang: 'en', value: category.name });
    }
    if (req.body.descriptions !== undefined) category.descriptions = req.body.descriptions;
    if (req.body.image !== undefined) category.image = req.body.image;
    if (req.body.active !== undefined) category.active = req.body.active;
    await category.save();
    return sendSuccess(res, 'Category updated', category);
  })
);

router.delete('/categories/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
  if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
  return sendSuccess(res, 'Category deactivated', category);
}));

router.get('/equipment-types', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category) {
    const category = await findCategory(req.query.category);
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    filter.category = category._id;
  }
  if (req.query.active === 'true' || req.query.active === 'false') filter.active = req.query.active === 'true';
  const products = await EquipmentType.find(filter).populate('category', 'name slug active').sort('name');
  return sendSuccess(res, 'Equipment catalog', products);
}));

const equipmentTypeValidators = [
  body('category').isString().trim().notEmpty(),
  body('name').trim().notEmpty().isLength({ max: 180 }),
  body('slug').optional().trim().isLength({ min: 1, max: 200 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  body('description').optional().isString().isLength({ max: 2000 }),
  body('descriptions').optional().isArray({ max: 3 }),
  body('descriptions.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('descriptions.*.value').optional().isString().trim().isLength({ max: 2000 }),
  body('shortDescription').optional().isString().isLength({ max: 300 }),
  body('brand').optional().isString().isLength({ max: 100 }),
  body('defaultDailyRate').optional().isFloat({ min: 0 }),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('aliases').optional().isArray({ max: 40 }),
  body('aliases.*').optional().isString().trim().isLength({ max: 120 }),
  body('searchTerms').optional().isArray({ max: 40 }),
  body('searchTerms.*').optional().isString().trim().isLength({ max: 120 }),
  body('taskTerms').optional().isArray({ max: 40 }),
  body('taskTerms.*').optional().isString().trim().isLength({ max: 160 }),
  body('names').optional().isArray({ max: 10 }),
  body('names.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('names.*.value').optional().isString().trim().isLength({ max: 180 }),
  body('imageUrls').optional().isArray({ max: 20 }),
  body('imageUrls.*').optional().isURL({ require_protocol: true }).isLength({ max: 2048 }),
  body('active').optional().isBoolean()
];
const equipmentTypePatchValidators = [
  body('category').optional().isString().trim().notEmpty(),
  body('name').optional().trim().notEmpty().isLength({ max: 180 }),
  body('slug').optional().trim().isLength({ min: 1, max: 200 }).matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  body('description').optional().isString().isLength({ max: 2000 }),
  body('descriptions').optional().isArray({ max: 3 }),
  body('descriptions.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('descriptions.*.value').optional().isString().trim().isLength({ max: 2000 }),
  body('shortDescription').optional().isString().isLength({ max: 300 }),
  body('brand').optional().isString().isLength({ max: 100 }),
  body('defaultDailyRate').optional().isFloat({ min: 0 }),
  body('replacementValue').optional().isFloat({ min: 0 }),
  body('depositAmount').optional().isFloat({ min: 0 }),
  body('aliases').optional().isArray({ max: 40 }),
  body('aliases.*').optional().isString().trim().isLength({ max: 120 }),
  body('searchTerms').optional().isArray({ max: 40 }),
  body('searchTerms.*').optional().isString().trim().isLength({ max: 120 }),
  body('taskTerms').optional().isArray({ max: 40 }),
  body('taskTerms.*').optional().isString().trim().isLength({ max: 160 }),
  body('names').optional().isArray({ max: 10 }),
  body('names.*.lang').optional().isIn(['en', 'hi', 'ta']),
  body('names.*.value').optional().isString().trim().isLength({ max: 180 }),
  body('imageUrls').optional().isArray({ max: 20 }),
  body('imageUrls.*').optional().isURL({ require_protocol: true }).isLength({ max: 2048 }),
  body('active').optional().isBoolean()
];

router.post('/equipment-types', ...equipmentTypeValidators, validate, asyncHandler(async (req, res) => {
  const category = await findCategory(req.body.category);
  if (!category || !category.active) throw new AppError('Select an active category', 400, 'INVALID_CATEGORY');
  const slug = slugify(req.body.slug || req.body.name);
  if (!slug) throw new AppError('A catalog product slug is required', 400, 'VALIDATION_ERROR');
  const product = await EquipmentType.create({
    name: req.body.name,
    description: req.body.description || '',
    descriptions: req.body.descriptions || [],
    shortDescription: req.body.shortDescription || '',
    brand: req.body.brand || '',
    defaultDailyRate: req.body.defaultDailyRate ?? 0,
    replacementValue: req.body.replacementValue ?? 0,
    depositAmount: req.body.depositAmount ?? 0,
    aliases: req.body.aliases || [],
    searchTerms: req.body.searchTerms || [],
    taskTerms: req.body.taskTerms || [],
    names: req.body.names || [],
    normalizedSearchTerms: [...new Set([
      req.body.name, req.body.brand, req.body.description, ...(req.body.descriptions || []).map((entry) => entry.value),
      ...(req.body.names || []).map((name) => name.value),
      ...(req.body.aliases || []), ...(req.body.searchTerms || []), ...(req.body.taskTerms || [])
    ].filter(Boolean).map(normalizeSearchText))],
    imageUrls: req.body.imageUrls || [],
    category: category._id,
    slug,
    active: req.body.active ?? true
  });
  return sendSuccess(res, 'Catalog product created', product, 201);
}));

router.patch('/equipment-types/:id',
  objectId(),
  ...equipmentTypePatchValidators,
  validate,
  asyncHandler(async (req, res) => {
    const product = await EquipmentType.findById(req.params.id);
    if (!product) throw new AppError('Catalog product not found', 404, 'NOT_FOUND');
    if (req.body.category !== undefined) {
      const category = await findCategory(req.body.category);
      if (!category || !category.active) throw new AppError('Select an active category', 400, 'INVALID_CATEGORY');
      product.category = category._id;
    }
    const updateFields = [
      'name', 'description', 'descriptions', 'shortDescription', 'brand', 'defaultDailyRate', 'replacementValue',
      'depositAmount', 'aliases', 'searchTerms', 'taskTerms', 'names', 'imageUrls', 'active'
    ];
    for (const field of updateFields) if (req.body[field] !== undefined) product[field] = req.body[field];
    if (req.body.slug !== undefined) product.slug = slugify(req.body.slug);
    else if (req.body.name !== undefined) product.slug = slugify(req.body.name);
    if (['name', 'brand', 'description', 'descriptions', 'shortDescription', 'names', 'aliases', 'searchTerms', 'taskTerms'].some((field) => req.body[field] !== undefined)) {
      product.normalizedSearchTerms = [...new Set([
        product.name, product.brand, product.description, product.shortDescription,
        ...product.descriptions.map((entry) => entry.value), ...product.names.map((name) => name.value),
        ...product.aliases, ...product.searchTerms, ...product.taskTerms
      ].filter(Boolean).map(normalizeSearchText))];
    }
    if (req.body.active === false && await EquipmentAsset.exists({ equipmentType: product._id, active: true })) {
      throw new AppError('Deactivate the associated equipment listings before deactivating this catalog product', 409, 'ACTIVE_LISTINGS');
    }
    await product.save();
    return sendSuccess(res, 'Catalog product updated', product);
  })
);

router.delete('/equipment-types/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const product = await EquipmentType.findById(req.params.id);
  if (!product) throw new AppError('Catalog product not found', 404, 'NOT_FOUND');
  if (await EquipmentAsset.exists({ equipmentType: product._id, active: true })) {
    throw new AppError('Deactivate the associated equipment listings before deactivating this catalog product', 409, 'ACTIVE_LISTINGS');
  }
  product.active = false;
  await product.save();
  return sendSuccess(res, 'Catalog product deactivated', product);
}));

module.exports = router;
