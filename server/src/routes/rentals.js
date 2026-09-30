const express = require('express');
const Rental = require('../models/Rental');
const Delivery = require('../models/Delivery');
const RentalReturn = require('../models/Return');
const DeliveryConditionReport = require('../models/DeliveryConditionReport');
const ReturnConditionReport = require('../models/ReturnConditionReport');
const { protect, allowRoles } = require('../middleware/auth');
const { objectId } = require('../validators');
const validate = require('../middleware/validate');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');

const router = express.Router();
router.use(protect, allowRoles('customer', 'owner', 'transporter', 'admin'));

function rentalFilter(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'customer') return { customer: user.id };
  if (user.role === 'owner') return { owner: user.id };
  return null;
}

router.get('/', asyncHandler(async (req, res) => {
  let filter = rentalFilter(req.user);
  if (!filter) {
    const rentalIds = await Delivery.find({ transporter: req.user.id }).distinct('rental');
    filter = { _id: { $in: rentalIds } };
  }
  const rentals = await Rental.find(filter).sort({ createdAt: -1 })
    .populate('equipment', 'name images dailyRate depositAmount location condition')
    .populate('owner', 'name businessName profileImageUrl')
    .populate('customer', 'name profileImageUrl');
  return sendSuccess(res, 'Rentals', rentals);
}));

router.get('/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const rental = await Rental.findById(req.params.id)
    .populate('equipment', 'name images dailyRate depositAmount location condition specifications')
    .populate('owner', 'name businessName profileImageUrl')
    .populate('customer', 'name profileImageUrl');
  if (!rental) throw new AppError('Rental not found', 404, 'NOT_FOUND');

  let authorized = req.user.role === 'admin' ||
    String(rental.customer._id) === req.user.id ||
    String(rental.owner._id) === req.user.id;
  if (!authorized && req.user.role === 'transporter') {
    authorized = Boolean(await Delivery.exists({ rental: rental._id, transporter: req.user.id }));
  }
  if (!authorized) throw new AppError('You cannot view this rental', 403, 'FORBIDDEN');

  const [deliveries, returnRecord] = await Promise.all([
    Delivery.find({ rental: rental._id }).populate('transporter', 'name phone vehicleInfo').sort({ createdAt: 1 }),
    RentalReturn.findOne({ rental: rental._id })
  ]);
  const [deliveryReports, returnReports] = await Promise.all([
    DeliveryConditionReport.find({ rental: rental._id }).sort({ recordedAt: -1 }),
    returnRecord ? ReturnConditionReport.find({ returnRecord: returnRecord._id }).populate('equipment', 'name assetId').sort({ inspectedAt: -1 }) : []
  ]);
  return sendSuccess(res, 'Rental details', { rental, deliveries, return: returnRecord, deliveryReports, returnReports });
}));

module.exports = router;