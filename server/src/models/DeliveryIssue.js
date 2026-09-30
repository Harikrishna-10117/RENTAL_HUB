const mongoose = require('mongoose');

const disputeResponseSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String, enum: ['customer', 'owner', 'transporter', 'admin'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  attachments: [{ type: String, trim: true, maxlength: 2048 }]
}, { timestamps: true });

const deliveryIssueSchema = new mongoose.Schema({
  rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental', required: true, index: true },
  delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', default: null, index: true },
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', default: null, index: true },
  conditionReport: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryConditionReport', default: null },
  evidence: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryEvidence' }],
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reporterRole: { type: String, enum: ['customer', 'owner', 'transporter', 'admin'], default: 'customer' },
  issueType: { type: String, default: 'delivery_issue', trim: true },
  disputeType: {
    type: String,
    enum: ['equipment_mismatch', 'damage', 'late_delivery', 'equipment_failure', 'cancellation', 'payment', 'transport', 'other'],
    default: 'other',
    index: true
  },
  summary: { type: String, required: true, trim: true },
  notes: { type: String, default: '' },
  attachments: [{ type: String, trim: true, maxlength: 2048 }],
  responses: { type: [disputeResponseSchema], default: [] },
  rentalStatusBeforeDispute: { type: String, default: '' },
  assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolution: { type: String, trim: true, maxlength: 4000, default: '' },
  status: { type: String, enum: ['open', 'under_review', 'action_required', 'resolved', 'closed'], default: 'open', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewOutcome: { type: String, default: '' },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryIssue', deliveryIssueSchema);
