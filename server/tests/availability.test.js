const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDates } = require('../src/services/availability');
const { AppError } = require('../src/utils/api');

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
