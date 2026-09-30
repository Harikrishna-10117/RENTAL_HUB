const express = require('express');
const Rental = require('../models/Rental');
const Delivery = require('../models/Delivery');
const DeliveryIssue = require('../models/DeliveryIssue');
const { protect, allowRoles } = require('../middleware/auth');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { body, objectId } = require('../validators');
const validate = require('../middleware/validate');
const idempotency = require('../middleware/idempotency');
const notify = require('../utils/notifications');

const router = express.Router();
router.use(protect);

async function canAccessDispute(dispute, user) {
  if (user.role === 'admin') return true;
  const rental = await Rental.findById(dispute.rental).select('customer owner');
  if (!rental) return false;
  if ([String(rental.customer), String(rental.owner)].includes(String(user.id))) return true;
  return user.role === 'transporter' && dispute.delivery
    ? Boolean(await Delivery.exists({ _id: dispute.delivery, transporter: user.id }))
    : false;
}

async function notifyDisputeParties(dispute, type, title, message) {
  const rental = await Rental.findById(dispute.rental).select('customer owner');
  const recipients = new Set([String(rental?.customer || ''), String(rental?.owner || '')]);
  if (dispute.delivery) {
    const delivery = await Delivery.findById(dispute.delivery).select('transporter');
    if (delivery?.transporter) recipients.add(String(delivery.transporter));
  }
  recipients.delete('');
  await Promise.all([...recipients].map((user) => notify(user, type, title, message, {
    disputeId: dispute._id,
    rentalId: dispute.rental
  })));
}

router.get('/', asyncHandler(async (req, res) => {
  let filter = {};
  if (req.user.role !== 'admin') {
    let rentals = [];
    if (req.user.role === 'customer') rentals = await Rental.find({ customer: req.user.id }).distinct('_id');
    else if (req.user.role === 'owner') rentals = await Rental.find({ owner: req.user.id }).distinct('_id');
    else if (req.user.role === 'transporter') rentals = await Delivery.find({ transporter: req.user.id }).distinct('rental');
    filter = { rental: { $in: rentals } };
  }
  const disputes = await DeliveryIssue.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate('rental', 'customer owner equipment status')
    .populate('reporter', 'name role')
    .populate('assignedAdmin', 'name');
  return sendSuccess(res, 'Disputes', disputes);
}));

router.post('/', allowRoles('customer', 'owner', 'transporter'), idempotency,
  body('rentalId').isMongoId().withMessage('A valid rental is required'),
  body('deliveryId').optional().isMongoId(),
  body('equipmentId').optional().isMongoId(),
  body('disputeType').isIn(['equipment_mismatch', 'damage', 'late_delivery', 'equipment_failure', 'cancellation', 'payment', 'transport', 'other']),
  body('summary').trim().notEmpty().isLength({ max: 500 }),
  body('notes').optional().isString().isLength({ max: 4000 }),
  body('attachments').optional().isArray({ max: 10 }),
  body('attachments.*').optional().custom((value) => {
    if (/^\/api\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(value)) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }),
  validate,
  asyncHandler(async (req, res) => {
    const rental = await Rental.findById(req.body.rentalId);
    if (!rental) throw new AppError('Rental not found', 404, 'NOT_FOUND');
    let delivery = null;
    if (req.body.deliveryId) {
      delivery = await Delivery.findOne({ _id: req.body.deliveryId, rental: rental._id });
      if (!delivery) throw new AppError('Delivery not found for this rental', 404, 'NOT_FOUND');
    }
    const participant = [String(rental.customer), String(rental.owner)].includes(req.user.id);
    const assignedTransporter = req.user.role === 'transporter' && delivery && String(delivery.transporter) === req.user.id;
    if (!participant && !assignedTransporter) throw new AppError('You cannot report an issue for this rental', 403, 'FORBIDDEN');
    if (req.body.equipmentId && !rental.equipment.some((item) => String(item) === req.body.equipmentId)) {
      throw new AppError('Equipment does not belong to this rental', 400, 'INVALID_EQUIPMENT');
    }
    const dispute = await DeliveryIssue.create({
      rental: rental._id,
      delivery: delivery?._id || null,
      equipment: req.body.equipmentId || delivery?.equipment || rental.equipment[0] || null,
      reporter: req.user.id,
      reporterRole: req.user.role,
      issueType: req.body.disputeType,
      disputeType: req.body.disputeType,
      summary: req.body.summary,
      notes: req.body.notes || '',
      attachments: req.body.attachments || [],
      rentalStatusBeforeDispute: rental.status,
      status: 'open'
    });
    rental.status = 'DISPUTED';
    await rental.save();
    await notifyDisputeParties(dispute, 'dispute_opened', 'Rental dispute opened', dispute.summary);
    return sendSuccess(res, 'Dispute opened', dispute, 201);
  })
);

router.get('/:id', objectId(), validate, asyncHandler(async (req, res) => {
  const dispute = await DeliveryIssue.findById(req.params.id)
    .populate('rental', 'customer owner equipment status')
    .populate('reporter', 'name role')
    .populate('responses.author', 'name role')
    .populate('assignedAdmin', 'name');
  if (!dispute) throw new AppError('Dispute not found', 404, 'NOT_FOUND');
  if (!await canAccessDispute(dispute, req.user)) throw new AppError('You cannot view this dispute', 403, 'FORBIDDEN');
  return sendSuccess(res, 'Dispute details', dispute);
}));

router.post('/:id/responses', idempotency, objectId(),
  body('message').trim().notEmpty().isLength({ max: 4000 }),
  body('attachments').optional().isArray({ max: 10 }),
  body('attachments.*').optional().custom((value) => {
    if (/^\/api\/uploads\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i.test(value)) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }),
  validate,
  asyncHandler(async (req, res) => {
    const dispute = await DeliveryIssue.findById(req.params.id);
    if (!dispute) throw new AppError('Dispute not found', 404, 'NOT_FOUND');
    if (!await canAccessDispute(dispute, req.user)) throw new AppError('You cannot respond to this dispute', 403, 'FORBIDDEN');
    if (['resolved', 'closed'].includes(dispute.status)) throw new AppError('This dispute is no longer accepting responses', 409, 'INVALID_STATE');
    dispute.responses.push({
      author: req.user.id,
      authorRole: req.user.role,
      message: req.body.message,
      attachments: req.body.attachments || []
    });
    if (dispute.status === 'action_required' && req.user.role !== 'admin') dispute.status = 'under_review';
    await dispute.save();
    await notifyDisputeParties(dispute, 'dispute_response', 'Dispute updated', req.body.message);
    return sendSuccess(res, 'Dispute response saved', dispute, 201);
  })
);

router.patch('/:id/status', allowRoles('admin'), idempotency, objectId(),
  body('status').isIn(['under_review', 'action_required', 'resolved', 'closed']),
  body('resolution').optional().isString().isLength({ max: 4000 }),
  validate,
  asyncHandler(async (req, res) => {
    const dispute = await DeliveryIssue.findById(req.params.id);
    if (!dispute) throw new AppError('Dispute not found', 404, 'NOT_FOUND');
    const allowed = {
      open: ['under_review', 'action_required', 'resolved'],
      under_review: ['action_required', 'resolved'],
      action_required: ['under_review', 'resolved'],
      resolved: ['closed'],
      closed: []
    };
    if (!allowed[dispute.status]?.includes(req.body.status)) throw new AppError('Invalid dispute status transition', 409, 'INVALID_STATE');
    dispute.status = req.body.status;
    dispute.assignedAdmin ||= req.user.id;
    if (req.body.resolution !== undefined) dispute.resolution = req.body.resolution;
    await dispute.save();
    if (['resolved', 'closed'].includes(dispute.status)) {
      const rental = await Rental.findById(dispute.rental);
      if (rental?.status === 'DISPUTED') {
        rental.status = dispute.rentalStatusBeforeDispute || 'ACTIVE';
        await rental.save();
      }
    }
    await notifyDisputeParties(dispute, `dispute_${dispute.status}`, 'Dispute status updated', `The dispute is now ${dispute.status.replace('_', ' ')}.`);
    return sendSuccess(res, 'Dispute status updated', dispute);
  })
);

module.exports = router;