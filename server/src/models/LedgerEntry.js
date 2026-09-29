const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 200 },
  debitAccount: { type: String, required: true, trim: true, maxlength: 100 },
  creditAccount: { type: String, required: true, trim: true, maxlength: 100 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, default: 'INR', match: /^[A-Z]{3}$/ },
  sourceType: { type: String, required: true, maxlength: 80 },
  sourceId: { type: String, required: true, maxlength: 120 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: 'throw' });

ledgerEntrySchema.pre('save', function preventMutation(next) {
  if (!this.isNew) return next(new Error('Ledger entries are immutable'));
  return next();
});

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne']) {
  ledgerEntrySchema.pre(operation, function preventQueryMutation(next) {
    return next(new Error('Ledger entries are append-only'));
  });
}

ledgerEntrySchema.pre('deleteOne', { document: true, query: false }, function preventDocumentDeletion(next) {
  return next(new Error('Ledger entries are append-only'));
});

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
