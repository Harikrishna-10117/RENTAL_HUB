const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIndianPhone } = require('../src/utils/india');

test('normalizeIndianPhone accepts domestic and +91 mobile formats', () => {
  assert.equal(normalizeIndianPhone('9876543210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('+91 98765 43210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('09876543210'), '+91 98765 43210');
});

test('normalizeIndianPhone rejects non-Indian and malformed numbers', () => {
  assert.equal(normalizeIndianPhone('1234567890'), '');
  assert.equal(normalizeIndianPhone('+1 415 555 0100'), '');
  assert.equal(normalizeIndianPhone('not a phone'), '');
});
