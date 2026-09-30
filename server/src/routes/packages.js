const express = require('express');
const Package = require('../models/Package');
const Equipment = require('../models/Equipment');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../validators');

const router = express.Router();

router.get('/mine', protect, allowRoles('owner'), asyncHandler(async (req, res) => {
  const packages = await Package.find({ owner: req.user.id }).sort({ createdAt: -1 })
    .populate({ path: 'equipment', select: 'name images dailyRate location active status category', populate: { path: 'category', select: 'name names' } });
  return sendSuccess(res, 'Your rental packages', packages);
}));

router.get('/', asyncHandler(async (req, res) => {
  const packages = await Package.find({ active: true })
    .populate({ path: 'equipment', match: { active: true, status: 'available' }, select: 'name images dailyRate location' })
    .populate('owner', 'name ownerVerified');
  return sendSuccess(res, 'Rental packages', packages.filter((pkg) => pkg.equipment.length));
}));

router.post('/',
  protect, allowRoles('owner'),
  body('name').trim().notEmpty().isLength({ max: 140 }),
  body('description').optional().isString(),
  body('equipment').isArray({ min: 1, max: 10 }),
  body('equipment.*').isMongoId(),
  body('dailyRate').optional().isFloat({ min: 0 }),
  validate,
  asyncHandler(async (req, res) => {
    if (!req.user.ownerVerified) throw new AppError('Your owner account must be verified before publishing a package', 403, 'OWNER_NOT_VERIFIED');
    const ids = [...new Set(req.body.equipment)];
    const items = await Equipment.find({ _id: { $in: ids }, owner: req.user.id, active: true });
    if (ids.length !== req.body.equipment.length || items.length !== ids.length) {
      throw new AppError('Packages can only contain distinct equipment items owned by you', 400, 'INVALID_PACKAGE_ITEMS');
    }
    const dailyRate = req.body.dailyRate === undefined
      ? items.reduce((sum, item) => sum + item.dailyRate, 0)
      : Number(req.body.dailyRate);
    const pkg = await Package.create({
      owner: req.user.id, name: req.body.name, description: req.body.description || '', equipment: ids, dailyRate
    });
    return sendSuccess(res, 'Package created', pkg, 201);
  })
);

router.patch('/:id',
  protect, allowRoles('owner'), objectId(),
  body('name').optional().trim().notEmpty().isLength({ max: 140 }),
  body('description').optional().isString(),
  body('dailyRate').optional().isFloat({ min: 0 }),
  body('active').optional().isBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    const pkg = await Package.findOne({ _id: req.params.id, owner: req.user.id });
    if (!pkg) throw new AppError('Package not found', 404, 'NOT_FOUND');
    for (const field of ['name', 'description', 'dailyRate', 'active']) {
      if (req.body[field] !== undefined) pkg[field] = req.body[field];
    }
    await pkg.save();
    return sendSuccess(res, 'Package updated', pkg);
  })
);

module.exports = router;
