const mongoose = require('mongoose');

const DELIVERY_TRANSITIONS = {
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PICKUP_PENDING', 'CANCELLED'],
  PICKUP_PENDING: ['PICKED_UP', 'FAILED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['ARRIVED', 'FAILED'],
  ARRIVED: ['CONDITION_CHECK', 'FAILED'],
  CONDITION_CHECK: ['HANDOVER_PENDING', 'FAILED'],
  HANDOVER_PENDING: ['DELIVERED', 'FAILED'],
  DELIVERED: ['RETURN_ASSIGNED'],
  FAILED: ['CANCELLED'],
  CANCELLED: [],
  RETURN_ASSIGNED: ['RETURN_PICKUP_PENDING', 'RETURN_COMPLETED'],
  RETURN_PICKUP_PENDING: ['RETURN_PICKED_UP', 'RETURN_COMPLETED'],
  RETURN_PICKED_UP: ['RETURN_IN_TRANSIT', 'RETURN_COMPLETED'],
  RETURN_IN_TRANSIT: ['RETURN_ARRIVED', 'RETURN_COMPLETED'],
  RETURN_ARRIVED: ['RETURN_INSPECTION', 'RETURN_COMPLETED'],
  RETURN_INSPECTION: ['RETURN_COMPLETED'],
  RETURN_COMPLETED: []
};

const LEGACY_STATUS_MAP = {
  scheduled: 'ASSIGNED',
  out_for_delivery: 'IN_TRANSIT',
  delivered: 'DELIVERED',
  pickup_scheduled: 'RETURN_ASSIGNED',
  returned: 'RETURN_COMPLETED',
  accepted: 'ACCEPTED',
  picked_up: 'PICKED_UP',
  condition_check: 'CONDITION_CHECK',
  handover_pending: 'HANDOVER_PENDING'
};

function normalizeDeliveryStatus(value) {
  if (!value && value !== '') return 'ASSIGNED';
  const raw = String(value).trim();
  if (!raw) return 'ASSIGNED';
  const uppercase = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(DELIVERY_TRANSITIONS, uppercase)) return uppercase;
  if (LEGACY_STATUS_MAP[raw]) return LEGACY_STATUS_MAP[raw];
  const normalizedKey = raw.replace(/[-\s]+/g, '_').toLowerCase();
  if (LEGACY_STATUS_MAP[normalizedKey]) return LEGACY_STATUS_MAP[normalizedKey];
  return uppercase;
}

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: false });

const deliverySchema = new mongoose.Schema({
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
  returnRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalReturn', default: null, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt: { type: Date, default: null },
  assignmentRejectedAt: { type: Date, default: null },
  assignmentRejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
  failureCode: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: Object.keys(DELIVERY_TRANSITIONS).concat(['scheduled', 'out_for_delivery', 'pickup_scheduled', 'returned', 'accepted', 'picked_up', 'condition_check', 'handover_pending']),
    default: 'ASSIGNED',
    set: normalizeDeliveryStatus,
    get: (value) => normalizeDeliveryStatus(value)
  },
  address: { type: String, required: true },
  location: { type: mongoose.Schema.Types.Mixed, default: null },
  conditionReport: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryConditionReport', default: null },
  handoverAcknowledgement: { type: mongoose.Schema.Types.ObjectId, ref: 'HandoverAcknowledgement', default: null },
  issue: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryIssue', default: null },
  serviceType: { type: String, enum: ['delivery', 'return_pickup'], default: 'delivery' },
  scheduledAt: { type: Date, default: null },
  acceptedAt: { type: Date, default: null },
  pickedUpAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  returnedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  notes: { type: String, default: '' },
  failureReason: { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  statusHistory: { type: [statusHistorySchema], default: [] }
}, { timestamps: true, toJSON: { getters: true, setters: true }, toObject: { getters: true, setters: true } });

deliverySchema.index({ rental: 1, equipment: 1, status: 1 });

deliverySchema.methods.canTransitionTo = function(nextStatus) {
  return DELIVERY_TRANSITIONS[normalizeDeliveryStatus(this.status)]?.includes(normalizeDeliveryStatus(nextStatus));
};

deliverySchema.statics.normalizeStatus = normalizeDeliveryStatus;
deliverySchema.statics.canTransition = function(currentStatus, nextStatus) {
  return DELIVERY_TRANSITIONS[normalizeDeliveryStatus(currentStatus)]?.includes(normalizeDeliveryStatus(nextStatus));
};

module.exports = mongoose.model('Delivery', deliverySchema);
module.exports.DELIVERY_TRANSITIONS = DELIVERY_TRANSITIONS;
module.exports.normalizeDeliveryStatus = normalizeDeliveryStatus;
