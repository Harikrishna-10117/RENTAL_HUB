const express = require('express');
const { body, objectId } = require('../validators');
const validate = require('../middleware/validate');
const { protect, allowRoles } = require('../middleware/auth');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const notify = require('../utils/notifications');
const Booking = require('../models/Booking');
const Rental = require('../models/Rental');
const Delivery = require('../models/Delivery');
const DeliveryConditionReport = require('../models/DeliveryConditionReport');
const DeliveryEvidence = require('../models/DeliveryEvidence');
const HandoverAcknowledgement = require('../models/HandoverAcknowledgement');
const DeliveryIssue = require('../models/DeliveryIssue');
const DeliveryLocation = require('../models/DeliveryLocation');
const RentalReturn = require('../models/Return');
const User = require('../models/User');

const router = express.Router();
router.use(protect);

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string' || value instanceof String) return String(value);
  if (value._id) return String(value._id);
  return String(value);
}

function canAccessDelivery(delivery, user) {
  if (!delivery || !user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'transporter') {
    return [delivery.transporter, delivery.assignedBy].some((value) => idOf(value) === String(user._id));
  }
  if (user.role === 'owner') return idOf(delivery.owner) === String(user._id);
  if (user.role === 'customer') return idOf(delivery.customer) === String(user._id);
  return false;
}

async function loadDeliveryWithAccess(req) {
  const delivery = await Delivery.findById(req.params.id)
    .populate('rental', '_id customer owner equipment status')
    .populate('equipment', '_id name equipmentType')
    .populate('customer', '_id name email role')
    .populate('owner', '_id name email role')
    .populate('transporter', '_id name email role');
  if (!delivery) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  if (!canAccessDelivery(delivery, req.user)) throw new AppError('You do not have access to this delivery', 403, 'FORBIDDEN');
  return delivery;
}

async function emitDeliveryUpdate(io, deliveryId, event, payload) {
  if (!io) return;
  io.to(`user:${String(payload?.userId || '')}`).emit(event, payload);
  io.to(`delivery:${String(deliveryId)}`).emit(event, payload);
}

router.get('/', asyncHandler(async (req, res) => {
  const query = {};
  if (req.user.role === 'customer') query.customer = req.user.id;
  else if (req.user.role === 'owner') query.owner = req.user.id;
  else if (req.user.role === 'transporter') query.transporter = req.user.id;
  const deliveries = await Delivery.find(query).sort({ createdAt: -1 }).populate('rental', '_id status').populate('equipment', '_id name');
  return sendSuccess(res, 'Deliveries', deliveries);
}));

router.get('/transporters', allowRoles('owner', 'admin'), asyncHandler(async (req, res) => {
  const transporters = await User.find({ role: 'transporter', active: true })
    .select('_id name phone vehicleInfo serviceArea').sort({ name: 1 }).lean();
  return sendSuccess(res, 'Available transporters', transporters);
}));

router.post('/:id/assign', allowRoles('owner', 'admin'), objectId(),
  body('transporterId').isMongoId().withMessage('A valid transporter is required'),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    if (req.user.role === 'owner' && String(delivery.owner?._id || delivery.owner) !== req.user.id) {
      throw new AppError('Only the delivery owner can assign its transporter', 403, 'FORBIDDEN');
    }
    const isReturnPickup = delivery.serviceType === 'return_pickup';
    const assignableStatuses = isReturnPickup ? ['RETURN_ASSIGNED'] : ['ASSIGNED', 'CANCELLED'];
    if (!assignableStatuses.includes(delivery.status)) {
      throw new AppError('A transporter can only be assigned before the pickup is accepted', 409, 'INVALID_STATE');
    }
    const transporter = await User.findOne({ _id: req.body.transporterId, role: 'transporter', active: true }).select('_id');
    if (!transporter) throw new AppError('Active transporter not found', 404, 'TRANSPORTER_NOT_FOUND');
    const assigned = await Delivery.findOneAndUpdate(
      { _id: delivery._id, status: delivery.status },
      { $set: {
        transporter: transporter._id,
        assignedBy: req.user.id,
        assignedAt: new Date(),
        assignmentRejectedAt: null,
        assignmentRejectionReason: '',
        status: isReturnPickup ? 'RETURN_PICKUP_PENDING' : 'ASSIGNED'
      } },
      { new: true }
    );
    if (!assigned) throw new AppError('Delivery changed while assignment was processed', 409, 'INVALID_STATE');
    await notify(transporter._id, 'delivery_assigned', 'Delivery assigned', 'A delivery has been assigned to you.', { deliveryId: assigned._id, rentalId: assigned.rental });
    const io = req.app.get('io');
    if (io) {
      const event = { deliveryId: String(assigned._id), status: assigned.status };
      io.to(`user:${String(transporter._id)}`).emit('delivery_assigned', event);
      io.to(`delivery:${String(assigned._id)}`).emit('delivery_assigned', event);
    }
    return sendSuccess(res, 'Transporter assigned', assigned);
  })
);

router.post('/:id/reject', allowRoles('transporter'), objectId(),
  body('reason').optional().isString().isLength({ max: 500 }),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await Delivery.findOne({ _id: req.params.id, transporter: req.user.id });
    if (!delivery) throw new AppError('Delivery assignment not found', 404, 'NOT_FOUND');
    const returnPickup = delivery.serviceType === 'return_pickup';
    const rejectableStatuses = returnPickup ? ['RETURN_PICKUP_PENDING'] : ['ASSIGNED'];
    if (!rejectableStatuses.includes(delivery.status)) throw new AppError('Only an unaccepted delivery can be rejected', 409, 'INVALID_STATE');
    delivery.transporter = null;
    delivery.assignmentRejectedAt = new Date();
    delivery.assignmentRejectionReason = req.body.reason || '';
    if (returnPickup) delivery.status = 'RETURN_ASSIGNED';
    await delivery.save();
    await notify(delivery.owner, 'delivery_assignment_rejected', 'Transporter declined assignment', 'The assigned transporter declined this delivery.', { deliveryId: delivery._id, rentalId: delivery.rental });
    return sendSuccess(res, 'Delivery assignment declined', delivery);
  })
);

router.post('/:id/location', allowRoles('transporter'), objectId(),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
  body('accuracyMeters').optional().isFloat({ min: 0 }),
  body('recordedAt').optional().isISO8601(),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await Delivery.findOne({ _id: req.params.id, transporter: req.user.id });
    if (!delivery) throw new AppError('Delivery assignment not found', 404, 'NOT_FOUND');
    if (!['ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(delivery.status)) {
      throw new AppError('Location updates are not available in this delivery state', 409, 'INVALID_STATE');
    }
    const recordedAt = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();
    if (recordedAt > new Date(Date.now() + 30000) || recordedAt < new Date(Date.now() - 5 * 60 * 1000)) {
      throw new AppError('Location timestamp is outside the accepted time window', 400, 'INVALID_LOCATION_TIME');
    }
    const point = {
      latitude: Number(req.body.latitude),
      longitude: Number(req.body.longitude),
      accuracyMeters: req.body.accuracyMeters === undefined ? null : Number(req.body.accuracyMeters),
      recordedAt
    };
    const location = await DeliveryLocation.create({ delivery: delivery._id, ...point });
    delivery.location = point;
    await delivery.save();
    const payload = { deliveryId: String(delivery._id), ...point };
    const io = req.app.get('io');
    if (io) {
      io.to(`delivery:${String(delivery._id)}`).emit('delivery_location_updated', payload);
      io.to(`user:${String(delivery.customer)}`).emit('delivery_location_updated', payload);
      io.to(`user:${String(delivery.owner)}`).emit('delivery_location_updated', payload);
    }
    return sendSuccess(res, 'Delivery location recorded', location, 201);
  })
);

router.get('/:id/location', objectId(), asyncHandler(async (req, res) => {
  const delivery = await loadDeliveryWithAccess(req);
  const location = await DeliveryLocation.findOne({ delivery: delivery._id }).sort({ recordedAt: -1 }).lean();
  if (!location) return sendSuccess(res, 'Tracking unavailable', { available: false, message: 'Tracking unavailable' });
  return sendSuccess(res, 'Latest delivery location', { available: true, location });
}));

router.get('/:id', objectId(), asyncHandler(async (req, res) => {
  const delivery = await loadDeliveryWithAccess(req);
  const report = await DeliveryConditionReport.findOne({ delivery: delivery._id });
  const acknowledgement = await HandoverAcknowledgement.findOne({ delivery: delivery._id });
  return sendSuccess(res, 'Delivery details', { delivery, conditionReport: report, acknowledgement });
}));

router.patch('/:id/status', objectId(),
  body('status').notEmpty().trim().withMessage('Status is required'),
  body('reason').optional().isString().isLength({ max: 500 }),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    const nextStatus = Delivery.normalizeStatus(req.body.status);
    if (!Delivery.canTransition(delivery.status, nextStatus)) {
      throw new AppError(`Cannot change delivery from ${delivery.status} to ${nextStatus}`, 409, 'INVALID_STATE');
    }

    const updates = {
      status: nextStatus,
      updatedBy: req.user.id,
      notes: req.body.notes || delivery.notes,
      ...(req.body.reason ? { failureReason: req.body.reason } : {}),
      ...(nextStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      ...(nextStatus === 'RETURN_COMPLETED' ? { returnedAt: new Date() } : {}),
      ...(nextStatus === 'FAILED' ? { failedAt: new Date() } : {})
    };

    const updatedDelivery = await Delivery.findOneAndUpdate(
      { _id: delivery._id, status: delivery.status },
      { $set: updates, $push: { statusHistory: { status: nextStatus, changedAt: new Date(), changedBy: req.user.id } } },
      { new: true }
    );
    if (!updatedDelivery) throw new AppError('Delivery changed while being updated', 409, 'INVALID_STATE');

    if (updatedDelivery.serviceType === 'return_pickup') {
      const returnStatus = {
        RETURN_ASSIGNED: 'RETURN_ASSIGNED',
        RETURN_PICKUP_PENDING: 'RETURN_PICKUP_PENDING',
        RETURN_PICKED_UP: 'RETURN_PICKED_UP',
        RETURN_IN_TRANSIT: 'RETURN_IN_TRANSIT',
        RETURN_ARRIVED: 'RETURN_ARRIVED',
        RETURN_INSPECTION: 'RETURN_INSPECTION'
      }[nextStatus];
      if (returnStatus) await RentalReturn.updateOne({ _id: updatedDelivery.returnRecord }, { $set: { status: returnStatus } });
    }

    const rental = await Rental.findById(updatedDelivery.rental);
    const booking = await Booking.findById(updatedDelivery.booking || rental?.booking || updatedDelivery.rental);
    if (rental && nextStatus === 'DELIVERED') {
      rental.status = 'ACTIVE';
      await rental.save();
    }
    if (rental && nextStatus === 'RETURN_COMPLETED') {
      rental.status = 'COMPLETED';
      await rental.save();
    }
    if (booking) {
      if (nextStatus === 'DELIVERED' && ['pending_payment', 'approved', 'confirmed', 'in_progress'].includes(booking.status)) {
        booking.status = 'in_progress';
        await booking.save();
      }
      if (nextStatus === 'RETURN_COMPLETED' && booking.status !== 'completed') {
        booking.status = 'completed';
        await booking.save();
      }
    }

    const paymentInfo = { rentalId: String(updatedDelivery.rental), deliveryId: String(updatedDelivery._id), userId: String(req.user._id) };
    const io = req.app.get('io');
    if (io) {
      io.to(`delivery:${String(updatedDelivery._id)}`).emit('delivery_status_changed', { deliveryId: updatedDelivery._id, status: nextStatus, userId: req.user.id });
      io.to(`user:${String(updatedDelivery.customer)}`).emit('delivery_status_changed', { ...paymentInfo, status: nextStatus });
      io.to(`user:${String(updatedDelivery.owner)}`).emit('delivery_status_changed', { ...paymentInfo, status: nextStatus });
      io.to(`user:${String(updatedDelivery.transporter)}`).emit('delivery_status_changed', { ...paymentInfo, status: nextStatus });
    }

    const messages = {
      ASSIGNED: 'Delivery assigned',
      ACCEPTED: 'Delivery accepted by transporter',
      PICKUP_PENDING: 'Pickup pending',
      PICKED_UP: 'Equipment picked up',
      IN_TRANSIT: 'Equipment in transit',
      ARRIVED: 'Delivery arrived at destination',
      CONDITION_CHECK: 'Condition inspection started',
      HANDOVER_PENDING: 'Handover is awaiting customer confirmation',
      DELIVERED: 'Delivery completed',
      FAILED: 'Delivery failed',
      RETURN_ASSIGNED: 'Return pickup assigned',
      RETURN_PICKUP_PENDING: 'Return pickup pending',
      RETURN_PICKED_UP: 'Return pickup completed',
      RETURN_IN_TRANSIT: 'Equipment in return transit',
      RETURN_ARRIVED: 'Return arrived for inspection',
      RETURN_INSPECTION: 'Return inspection started',
      RETURN_COMPLETED: 'Return inspection complete'
    };
    await notify(updatedDelivery.customer, `delivery_${nextStatus.toLowerCase()}`, messages[nextStatus] || 'Delivery status updated', `Delivery status changed to ${nextStatus}.`, { deliveryId: updatedDelivery._id, rentalId: updatedDelivery.rental });
    await notify(updatedDelivery.owner, `delivery_${nextStatus.toLowerCase()}`, messages[nextStatus] || 'Delivery status updated', `Delivery status changed to ${nextStatus}.`, { deliveryId: updatedDelivery._id, rentalId: updatedDelivery.rental });
    if (updatedDelivery.transporter) await notify(updatedDelivery.transporter, `delivery_${nextStatus.toLowerCase()}`, messages[nextStatus] || 'Delivery status updated', `Delivery status changed to ${nextStatus}.`, { deliveryId: updatedDelivery._id, rentalId: updatedDelivery.rental });

    return sendSuccess(res, 'Delivery status updated', updatedDelivery);
  })
);

router.post('/:id/condition-report', objectId(),
  body('overallCondition').optional().isIn(['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL']),
  body('photos').optional().isArray({ max: 20 }),
  body('checklist').optional().isObject(),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    const rental = await Rental.findById(delivery.rental);
    if (!rental && !await Booking.exists({ _id: delivery.booking || delivery.rental })) {
      throw new AppError('Rental not found', 404, 'NOT_FOUND');
    }

    const reportPayload = {
      delivery: delivery._id,
      rental: delivery.rental,
      equipment: delivery.equipment,
      owner: delivery.owner,
      customer: delivery.customer,
      transporter: delivery.transporter,
      conditionStatus: req.body.overallCondition || 'GOOD',
      overallCondition: req.body.overallCondition || 'GOOD',
      checklist: {
        scratches: req.body.checklist?.scratches || '',
        dents: req.body.checklist?.dents || '',
        cracks: req.body.checklist?.cracks || '',
        brokenComponents: req.body.checklist?.brokenComponents || '',
        missingComponents: req.body.checklist?.missingComponents || '',
        tyreCondition: req.body.checklist?.tyreCondition || '',
        externalBodyCondition: req.body.checklist?.externalBodyCondition || '',
        accessoriesIncluded: req.body.checklist?.accessoriesIncluded || [],
        attachmentsIncluded: req.body.checklist?.attachmentsIncluded || [],
        safetyEquipment: req.body.checklist?.safetyEquipment || [],
        meterReading: req.body.checklist?.meterReading || '',
        existingDamage: req.body.checklist?.existingDamage || '',
        notes: req.body.checklist?.notes || ''
      },
      existingDamage: req.body.existingDamage || req.body.checklist?.existingDamage || '',
      missingComponents: req.body.missingComponents || req.body.checklist?.missingComponents ? [req.body.missingComponents || req.body.checklist?.missingComponents].flat() : [],
      accessoriesIncluded: req.body.accessoriesIncluded || req.body.checklist?.accessoriesIncluded || [],
      attachmentsIncluded: req.body.attachmentsIncluded || req.body.checklist?.attachmentsIncluded || [],
      usageReading: req.body.usageReading || req.body.checklist?.meterReading || '',
      notes: req.body.notes || req.body.checklist?.notes || '',
      acknowledged: false
    };

    const report = await DeliveryConditionReport.findOneAndUpdate(
      { delivery: delivery._id },
      { $set: reportPayload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    delivery.conditionReport = report._id;
    delivery.deliveryNotes = report.notes;
    await delivery.save();

    const photoArray = Array.isArray(req.body.photos) ? req.body.photos : [];
    if (photoArray.length) {
      const evidenceDocs = await Promise.all(photoArray.map((photo) => {
        if (!photo?.url) throw new AppError('Each delivery photo must include a valid URL', 400, 'INVALID_EVIDENCE');
        return DeliveryEvidence.create({
          delivery: delivery._id,
          rental: delivery.rental,
          equipment: delivery.equipment,
          uploader: req.user.id,
          type: photo.type || 'front',
          category: photo.category || 'delivery',
          url: photo.url,
          timestamp: photo.timestamp || new Date(),
          metadata: { imageType: photo.type || 'front', deliveryId: String(delivery._id), rentalId: String(delivery.rental), equipmentId: String(delivery.equipment) }
        });
      }));
      report.photos = evidenceDocs.map((entry) => ({ type: entry.type, url: entry.url, uploadedBy: entry.uploader, timestamp: entry.timestamp }));
      await report.save();
    }

    await notify(delivery.customer, 'condition_report_completed', 'Condition report completed', 'Your delivery condition report is ready for review.', { deliveryId: delivery._id, rentalId: delivery.rental });
    return sendSuccess(res, 'Condition report saved', report, 201);
  })
);

router.post('/:id/evidence', objectId(),
  body('type').notEmpty().isString().withMessage('Evidence type is required'),
  body('url').notEmpty().isURL({ require_protocol: true }).withMessage('A valid evidence URL is required'),
  body('category').optional().isString(),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    const evidence = await DeliveryEvidence.create({
      delivery: delivery._id,
      rental: delivery.rental,
      equipment: delivery.equipment,
      uploader: req.user.id,
      type: req.body.type,
      category: req.body.category || 'delivery',
      url: req.body.url,
      timestamp: new Date(),
      metadata: {
        deliveryId: String(delivery._id),
        rentalId: String(delivery.rental),
        equipmentId: String(delivery.equipment),
        uploader: String(req.user.id),
        imageType: req.body.type
      }
    });
    return sendSuccess(res, 'Delivery evidence uploaded', evidence, 201);
  })
);

router.post('/:id/acknowledge', objectId(),
  body('customerAck').optional().isBoolean(),
  body('transporterAck').optional().isBoolean(),
  body('deviceInfo').optional().isString(),
  body('sessionInfo').optional().isString(),
  body('location').optional().isObject(),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    const report = await DeliveryConditionReport.findOne({ delivery: delivery._id });
    const acknowledgement = await HandoverAcknowledgement.findOneAndUpdate(
      { delivery: delivery._id },
      {
        $set: {
          delivery: delivery._id,
          rental: delivery.rental,
          equipment: delivery.equipment,
          customer: delivery.customer,
          transporter: delivery.transporter,
          customerAcknowledged: req.body.customerAck ?? false,
          transporterAcknowledged: req.body.transporterAck ?? false,
          acknowledgedAt: new Date(),
          deviceInfo: req.body.deviceInfo || '',
          sessionInfo: req.body.sessionInfo || '',
          location: req.body.location || null,
          conditionReport: report ? report._id : null
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (report) {
      report.acknowledged = acknowledgement.customerAcknowledged || acknowledgement.transporterAcknowledged;
      report.acknowledgementTimestamp = acknowledgement.acknowledgedAt;
      await report.save();
    }
    if (acknowledgement.customerAcknowledged && acknowledgement.transporterAcknowledged) {
      await notify(delivery.customer, 'handover_accepted', 'Handover accepted', 'The equipment handover has been acknowledged by both parties.', { deliveryId: delivery._id, rentalId: delivery.rental });
    }
    return sendSuccess(res, 'Handover acknowledgement recorded', acknowledgement);
  })
);

router.post('/:id/issue', objectId(),
  body('summary').trim().notEmpty().withMessage('Issue summary is required'),
  body('notes').optional().isString().isLength({ max: 2000 }),
  validate,
  asyncHandler(async (req, res) => {
    const delivery = await loadDeliveryWithAccess(req);
    const conditionReport = await DeliveryConditionReport.findOne({ delivery: delivery._id });
    const issue = await DeliveryIssue.create({
      rental: delivery.rental,
      delivery: delivery._id,
      equipment: delivery.equipment,
      conditionReport: conditionReport?._id || null,
      evidence: [],
      reporter: req.user.id,
      reporterRole: req.user.role,
      issueType: 'delivery_issue',
      summary: req.body.summary,
      notes: req.body.notes || '',
      severity: req.body.severity || 'medium',
      status: 'open'
    });
    await notify(delivery.owner, 'delivery_issue_reported', 'Delivery issue reported', req.body.summary, { deliveryId: delivery._id, rentalId: delivery.rental, issueId: issue._id });
    await notify(delivery.customer, 'delivery_issue_reported', 'Delivery issue reported', req.body.summary, { deliveryId: delivery._id, rentalId: delivery.rental, issueId: issue._id });
    return sendSuccess(res, 'Issue reported', issue, 201);
  })
);

module.exports = router;
