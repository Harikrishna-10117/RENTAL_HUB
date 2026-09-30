const express = require('express');
const Rental = require('../models/Rental');
const RentalReturn = require('../models/Return');
const ReturnConditionReport = require('../models/ReturnConditionReport');
const Booking = require('../models/Booking');
const Delivery = require('../models/Delivery');
const DeliveryConditionReport = require('../models/DeliveryConditionReport');
const DeliveryEvidence = require('../models/DeliveryEvidence');
const Deposit = require('../models/Deposit');
const { protect, allowRoles } = require('../middleware/auth');
const { body, objectId } = require('../validators');
const validate = require('../middleware/validate');
const idempotency = require('../middleware/idempotency');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { inspectAssets } = require('../services/inventory');
const notify = require('../utils/notifications');

const router = express.Router();
router.use(protect);

async function loadReturn(id, user) {
  const returnRecord = await RentalReturn.findById(id)
    .populate('rental')
    .populate('booking')
    .populate('equipment', 'name assetId images')
    .populate('deliveries');
  if (!returnRecord) throw new AppError('Return not found', 404, 'NOT_FOUND');
  const allowed = user.role === 'admin' ||
    String(returnRecord.customer._id || returnRecord.customer) === user.id ||
    String(returnRecord.owner._id || returnRecord.owner) === user.id;
  if (!allowed) throw new AppError('You cannot access this return', 403, 'FORBIDDEN');
  return returnRecord;
}

router.get('/', asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {}
    : req.user.role === 'owner' ? { owner: req.user.id }
      : { customer: req.user.id };
  const returns = await RentalReturn.find(filter).sort({ createdAt: -1 })
    .populate('rental', 'startDate endDate status')
    .populate('equipment', 'name images')
    .populate({ path: 'deliveries', select: 'status transporter serviceType address', populate: { path: 'transporter', select: 'name phone vehicleInfo' } });
  return sendSuccess(res, 'Returns', returns);
}));

router.post('/rentals/:rentalId/request', allowRoles('customer'), idempotency,
  objectId('rentalId'), body('notes').optional().isString().isLength({ max: 2000 }), validate,
  asyncHandler(async (req, res) => {
    const rental = await Rental.findOne({ _id: req.params.rentalId, customer: req.user.id });
    if (!rental) throw new AppError('Rental not found', 404, 'NOT_FOUND');
    const existing = await RentalReturn.findOne({ rental: rental._id });
    if (existing) throw new AppError('A return is already open for this rental', 409, 'RETURN_EXISTS');
    if (rental.status !== 'ACTIVE') throw new AppError('Only an active rental can be returned', 409, 'INVALID_STATE');

    const deliveries = await Delivery.find({ rental: rental._id, serviceType: 'delivery', status: 'DELIVERED' });
    if (!deliveries.length) throw new AppError('All equipment must be delivered before requesting a return', 409, 'DELIVERY_NOT_COMPLETED');
    const returnRecord = await RentalReturn.create({
      rental: rental._id,
      booking: rental.booking,
      customer: rental.customer,
      owner: rental.owner,
      equipment: rental.equipment,
      deliveries: deliveries.map((delivery) => delivery._id),
      status: 'RETURN_ASSIGNED',
      requestedBy: req.user.id,
      notes: req.body.notes || ''
    });
    await Delivery.updateMany(
      { _id: { $in: deliveries.map((delivery) => delivery._id) }, status: 'DELIVERED' },
      {
        $set: { status: 'RETURN_ASSIGNED', serviceType: 'return_pickup', returnRecord: returnRecord._id, updatedBy: req.user.id },
        $push: { statusHistory: { status: 'RETURN_ASSIGNED', changedAt: new Date(), changedBy: req.user.id } }
      }
    );
    rental.status = 'RETURN_PENDING';
    await rental.save();
    const booking = await Booking.findById(rental.booking);
    if (booking) {
      booking.status = 'return_pending';
      await booking.save();
    }
    await notify(rental.owner, 'return_requested', 'Equipment return requested', 'A customer has requested a return pickup.', { returnId: returnRecord._id, rentalId: rental._id });
    return sendSuccess(res, 'Return requested', returnRecord, 201);
  })
);

router.get('/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const returnRecord = await loadReturn(req.params.id, req.user);
  const reports = await ReturnConditionReport.find({ returnRecord: returnRecord._id })
    .populate('conditionAtDelivery').populate('equipment', 'name assetId images').sort({ createdAt: 1 });
  return sendSuccess(res, 'Return details', { return: returnRecord, conditionReports: reports });
}));

router.post('/:id/inspection', allowRoles('owner', 'admin'), idempotency, objectId(),
  body('equipmentId').isMongoId().withMessage('A valid equipment ID is required'),
  body('condition').isIn(['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL']),
  body('checklist').optional().isObject(),
  body('damage').optional().isString().isLength({ max: 2000 }),
  body('evidenceUrls').optional().isArray({ max: 20 }),
  body('evidenceUrls.*').optional().custom((value) => {
    if (/^\/api\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(value)) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }),
  body('location').optional().isObject(),
  validate,
  asyncHandler(async (req, res) => {
    const returnRecord = await loadReturn(req.params.id, req.user);
    if (req.user.role === 'owner' && String(returnRecord.owner._id || returnRecord.owner) !== req.user.id) {
      throw new AppError('Only this rental owner can inspect the return', 403, 'FORBIDDEN');
    }
    if (!['RETURN_ARRIVED', 'RETURN_INSPECTION'].includes(returnRecord.status)) {
      throw new AppError('Return inspection is not available in this state', 409, 'INVALID_STATE');
    }
    const equipmentId = String(req.body.equipmentId);
    if (!returnRecord.equipment.some((item) => String(item._id || item) === equipmentId)) {
      throw new AppError('Equipment is not part of this return', 400, 'INVALID_EQUIPMENT');
    }
    const delivery = returnRecord.deliveries.find((item) => String(item.equipment) === equipmentId);
    if (!delivery) throw new AppError('Return delivery not found for equipment', 404, 'NOT_FOUND');
    const deliveryReport = await DeliveryConditionReport.findOne({ delivery: delivery._id });
    const photoDocs = await Promise.all((req.body.evidenceUrls || []).map((url) => DeliveryEvidence.create({
      delivery: delivery._id,
      rental: returnRecord.rental._id,
      equipment: equipmentId,
      uploader: req.user.id,
      type: 'damage',
      category: 'return',
      url,
      timestamp: new Date(),
      metadata: { returnId: String(returnRecord._id), imageType: 'damage' }
    })));
    const report = await ReturnConditionReport.findOneAndUpdate(
      { returnRecord: returnRecord._id, equipment: equipmentId },
      { $set: {
        rental: returnRecord.rental._id,
        delivery: delivery._id,
        inspector: req.user.id,
        conditionAtDelivery: deliveryReport?._id || null,
        condition: req.body.condition,
        checklist: req.body.checklist || {},
        damage: req.body.damage || '',
        photos: photoDocs.map((photo) => photo._id),
        evidenceUrls: req.body.evidenceUrls || [],
        location: req.body.location || null,
        inspectedAt: new Date()
      } },
      { new: true, upsert: true, runValidators: true }
    );
    if (returnRecord.status !== 'RETURN_INSPECTION') {
      returnRecord.status = 'RETURN_INSPECTION';
      await returnRecord.save();
    }
    await notify(returnRecord.customer, 'return_inspection_completed', 'Return inspection recorded', 'The owner recorded a return condition report.', { returnId: returnRecord._id, rentalId: returnRecord.rental._id });
    return sendSuccess(res, 'Return condition report saved', report, 201);
  })
);

router.post('/:id/complete', allowRoles('owner', 'admin'), idempotency, objectId(), validate,
  asyncHandler(async (req, res) => {
    const returnRecord = await loadReturn(req.params.id, req.user);
    if (req.user.role === 'owner' && String(returnRecord.owner._id || returnRecord.owner) !== req.user.id) {
      throw new AppError('Only this rental owner can complete its return', 403, 'FORBIDDEN');
    }
    if (!['RETURN_ARRIVED', 'RETURN_INSPECTION'].includes(returnRecord.status)) {
      throw new AppError('Return is not ready to complete', 409, 'INVALID_STATE');
    }
    const reports = await ReturnConditionReport.find({ returnRecord: returnRecord._id });
    if (reports.length !== returnRecord.equipment.length) {
      throw new AppError('Every returned equipment item requires an inspection report', 409, 'INSPECTION_REQUIRED');
    }
    const deposit = await Deposit.findOne({ booking: returnRecord.booking._id || returnRecord.booking });
    if (!deposit || ['held', 'refund_pending', 'refund_failed'].includes(deposit.status)) {
      throw new AppError('Complete the security-deposit inspection before closing the return', 409, 'DEPOSIT_NOT_INSPECTED');
    }
    for (const report of reports) {
      const condition = report.condition === 'DAMAGED' || report.condition === 'CRITICAL' ? 'needs_repair' : report.condition.toLowerCase();
      await inspectAssets([report.equipment], condition);
    }
    await Delivery.updateMany(
      { _id: { $in: returnRecord.deliveries.map((delivery) => delivery._id || delivery) }, status: { $in: ['RETURN_ARRIVED', 'RETURN_INSPECTION'] } },
      { $set: { status: 'RETURN_COMPLETED', returnedAt: new Date(), updatedBy: req.user.id }, $push: { statusHistory: { status: 'RETURN_COMPLETED', changedAt: new Date(), changedBy: req.user.id } } }
    );
    returnRecord.status = 'RETURN_COMPLETED';
    returnRecord.completedAt = new Date();
    await returnRecord.save();
    returnRecord.rental.status = 'COMPLETED';
    await returnRecord.rental.save();
    const booking = returnRecord.booking;
    booking.status = 'completed';
    await booking.save();
    await notify(returnRecord.customer, 'return_completed', 'Return completed', 'Your rental return and inspection are complete.', { returnId: returnRecord._id, rentalId: returnRecord.rental._id });
    return sendSuccess(res, 'Return completed', returnRecord);
  })
);

module.exports = router;