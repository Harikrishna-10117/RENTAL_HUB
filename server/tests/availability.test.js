const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDates } = require('../src/services/availability');
const { AppError } = require('../src/utils/api');
const { predictFromMaintenanceHistory } = require('../src/services/maintenancePrediction');

test('validateDates normalizes to UTC day boundaries and counts rental nights', () => {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);

  const result = validateDates(start.toISOString(), end.toISOString());
  assert.equal(result.rentalDays, 4);
  assert.equal(result.start.getUTCHours(), 0);
  assert.equal(result.end.getUTCHours(), 0);
});

test('validateDates rejects reversed and past ranges', () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  assert.throws(() => validateDates(tomorrow.toISOString(), now.toISOString()), AppError);
  assert.throws(() => validateDates('not-a-date', tomorrow.toISOString()), AppError);

  const yesterday = new Date(now.getTime() - 86400000);
  const today = new Date(now);
  assert.throws(() => validateDates(yesterday.toISOString(), today.toISOString()), AppError);
});

test('maintenance prediction requires enough real completed service history', () => {
  const asOf = new Date('2026-09-30T00:00:00.000Z');
  const insufficient = predictFromMaintenanceHistory([
    { status: 'COMPLETED', serviceDate: '2026-01-01T00:00:00.000Z' },
    { status: 'SCHEDULED', serviceDate: '2026-06-01T00:00:00.000Z' }
  ], asOf);
  assert.deepEqual(insufficient, {
    available: false,
    message: 'Insufficient usage history for a maintenance prediction.',
    completedServiceCount: 1
  });

  const prediction = predictFromMaintenanceHistory([
    { status: 'COMPLETED', serviceDate: '2026-01-01T00:00:00.000Z' },
    { status: 'COMPLETED', serviceDate: '2026-02-01T00:00:00.000Z' },
    { status: 'COMPLETED', serviceDate: '2026-03-04T00:00:00.000Z' }
  ], asOf);
  assert.equal(prediction.available, true);
  assert.equal(prediction.basis.completedServiceCount, 3);
  assert.equal(prediction.basis.medianServiceIntervalDays, 31);
  assert.equal(prediction.predictedNextServiceDate.toISOString(), '2026-04-04T00:00:00.000Z');
});
