const express = require('express');
const User = require('../models/User');
const Category = require('../models/Category');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect, allowRoles } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { body, objectId } = require('../utils/validation');
const notify = require('../utils/notifications');

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
  return sendSuccess(res, 'Marketplace categories', categories);
}));

router.post('/categories',
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('description').optional().isString().isLength({ max: 1000 }),
  validate,
  asyncHandler(async (req, res) => {
    const slug = req.body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const category = await Category.create({ name: req.body.name.trim(), slug, description: req.body.description || '' });
    return sendSuccess(res, 'Category created', category, 201);
  })
);

router.patch('/categories/:id',
  objectId(),
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('description').optional().isString().isLength({ max: 1000 }),
  body('active').optional().isBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    if (req.body.name !== undefined) {
      category.name = req.body.name.trim();
      category.slug = category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    if (req.body.description !== undefined) category.description = req.body.description;
    if (req.body.active !== undefined) category.active = req.body.active;
    await category.save();
    return sendSuccess(res, 'Category updated', category);
  })
);

module.exports = router;
