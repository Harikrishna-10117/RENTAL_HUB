const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../src/config/env');

const validEnvironment = {
  PORT: '5000',
  JWT_SECRET: 'foundation-test-secret-that-is-at-least-32-characters',
  NODE_ENV: 'development',
  PAYMENT_PROVIDER: 'mock'
};

test('environment validation supplies local defaults and parses the port', () => {
  assert.deepEqual(validateEnvironment(validEnvironment), {
    port: 5000,
    paymentProvider: 'mock',
    rateLimitStore: 'memory'
  });
});

test('environment validation rejects invalid ports and incomplete payment configuration', () => {
  assert.throws(
    () => validateEnvironment({ ...validEnvironment, PORT: '70000' }),
    /PORT must be an integer/
  );
  assert.throws(
    () => validateEnvironment({ ...validEnvironment, PAYMENT_PROVIDER: 'razorpay' }),
    /Razorpay requires/
  );
});

test('production requires shared rate limits and a configured payment provider', () => {
  const production = { ...validEnvironment, NODE_ENV: 'production', PAYMENT_PROVIDER: 'razorpay' };
  assert.throws(() => validateEnvironment(production), /Razorpay requires/);
  assert.throws(
    () => validateEnvironment({ ...production, RATE_LIMIT_STORE: 'memory', RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_WEBHOOK_SECRET: 'webhook' }),
    /shared RATE_LIMIT_STORE/
  );
  assert.deepEqual(
    validateEnvironment({ ...production, RATE_LIMIT_STORE: 'mongodb', RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 'secret', RAZORPAY_WEBHOOK_SECRET: 'webhook' }),
    { port: 5000, paymentProvider: 'razorpay', rateLimitStore: 'mongodb' }
  );
});
