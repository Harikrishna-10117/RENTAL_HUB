const express = require('express');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const Equipment = require('../models/Equipment');
const EquipmentBlockPeriod = require('../models/EquipmentBlockPeriod');
const { protect, allowRoles } = require('../middleware/auth');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { body, objectId } = require('../validators');
const validate = require('../middleware/validate');
const idempotency = require('../middleware/idempotency');
const { validateDates, assertAvailable, withReservationLocks } = require('../services/availability');
const { predictFromMaintenanceHistory } = require('../services/maintenancePrediction');

const router = express.Router();
router.use(protect);

router.get('/', allowRoles('owner', 'admin'), asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { owner: req.user.id };
  const records = await MaintenanceRecord.find(filter)
    .populate('equipment', 'name images location quantity')
    .sort({ startDate: -1 });
  return sendSuccess(res, 'Maintenance records', records);
}));

router.get('/equipment/:equipmentId/prediction', allowRoles('owner', 'admin'), objectId('equipmentId'), validate,
  asyncHandler(async (req, res) => {
    const equipment = await Equipment.findOne({
      _id: req.params.equipmentId,
      ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    }).select('_id name');
    if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    const history = await MaintenanceRecord.find({ equipment: equipment._id })
      .select('serviceDate status').sort({ serviceDate: 1 }).lean();
    return sendSuccess(res, 'Maintenance prediction', {
      equipment: { id: equipment._id, name: equipment.name },
      ...predictFromMaintenanceHistory(history)
    });
  })
);

router.post('/equipment/:equipmentId', allowRoles('owner', 'admin'), idempotency,
  objectId('equipmentId'),
  body('startDate').isISO8601().withMessage('A valid maintenance start date is required'),
  body('endDate').isISO8601().withMessage('A valid maintenance end date is required'),
  body('type').optional().isIn(['scheduled', 'repair', 'inspection']),
  body('quantity').optional().isInt({ min: 1, max: 1000 }),
  body('meterReading').optional().isString().isLength({ max: 100 }),
  body('notes').optional().isString().isLength({ max: 2000 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('nextServiceDate').optional({ nullable: true }).isISO8601(),
  validate,
  asyncHandler(async (req, res) => {
    const { start, end } = validateDates(req.body.startDate, req.body.endDate);
    const equipment = await Equipment.findOne({
      _id: req.params.equipmentId,
      ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!equipment) throw new AppError('Equipment not found', 404, 'NOT_FOUND');
    const quantity = req.body.quantity === undefined ? equipment.quantity || 1 : Number(req.body.quantity);
    if (quantity > (equipment.quantity || 1)) {
      throw new AppError('Maintenance quantity exceeds listed stock', 400, 'INVALID_BLOCK_QUANTITY');
    }

    let blockPeriod;
    let record;
    await withReservationLocks([equipment._id], async () => {
      await assertAvailable([equipment._id], start, end, undefined, [{ equipment: equipment._id, quantity }]);
      blockPeriod = await EquipmentBlockPeriod.create({
        equipment: equipment._id,
        createdBy: req.user.id,
        startDate: start,
        endDate: end,
        quantity: req.body.quantity === undefined ? null : quantity,
        type: 'MAINTENANCE',
        reason: req.body.notes || 'Scheduled maintenance'
      });
      try {
        record = await MaintenanceRecord.create({
          equipment: equipment._id,
          owner: equipment.owner,
          createdBy: req.user.id,
          blockPeriod: blockPeriod._id,
          type: req.body.type || 'scheduled',
          startDate: start,
          endDate: end,
          meterReading: req.body.meterReading || '',
          notes: req.body.notes || '',
          cost: Number(req.body.cost || 0),
          nextServiceDate: req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : null
        });
      } catch (error) {
        await EquipmentBlockPeriod.deleteOne({ _id: blockPeriod._id });
        throw error;
      }
    });
    return sendSuccess(res, 'Maintenance scheduled and inventory blocked', record, 201);
  })
);

router.patch('/:id/status', allowRoles('owner', 'admin'), idempotency, objectId(),
  body('status').isIn(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  body('serviceDate').optional({ nullable: true }).isISO8601(),
  body('meterReading').optional().isString().isLength({ max: 100 }),
  body('notes').optional().isString().isLength({ max: 2000 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('nextServiceDate').optional({ nullable: true }).isISO8601(),
  validate,
  asyncHandler(async (req, res) => {
    const record = await MaintenanceRecord.findOne({
      _id: req.params.id,
      ...(req.user.role === 'admin' ? {} : { owner: req.user.id })
    });
    if (!record) throw new AppError('Maintenance record not found', 404, 'NOT_FOUND');
    const allowed = {
      SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: []
    };
    if (!allowed[record.status].includes(req.body.status)) {
      throw new AppError(`Cannot change maintenance from ${record.status} to ${req.body.status}`, 409, 'INVALID_STATE');
    }
    record.status = req.body.status;
    if (req.body.serviceDate !== undefined) record.serviceDate = req.body.serviceDate ? new Date(req.body.serviceDate) : null;
    if (req.body.status === 'COMPLETED' && !record.serviceDate) record.serviceDate = new Date();
    if (req.body.meterReading !== undefined) record.meterReading = req.body.meterReading;
    if (req.body.notes !== undefined) record.notes = req.body.notes;
    if (req.body.cost !== undefined) record.cost = Number(req.body.cost);
    if (req.body.nextServiceDate !== undefined) record.nextServiceDate = req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : null;
    await record.save();
    if (['COMPLETED', 'CANCELLED'].includes(record.status) && record.blockPeriod) {
      await EquipmentBlockPeriod.updateOne({ _id: record.blockPeriod }, { $set: { active: false } });
    }
    return sendSuccess(res, 'Maintenance record updated', record);
  })
);

module.exports = router;