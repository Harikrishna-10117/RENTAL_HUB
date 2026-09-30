const dotenv = require('dotenv');

function loadEnvironment() {
  dotenv.config();
}

function validateEnvironment(env = process.env) {
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('Set JWT_SECRET to a random secret of at least 32 characters in server/.env.');
  }
  const rateLimitStore = env.RATE_LIMIT_STORE || (env.NODE_ENV === 'production' ? 'mongodb' : 'memory');
  if (!['memory', 'mongodb'].includes(rateLimitStore)) {
    throw new Error('RATE_LIMIT_STORE must be memory or mongodb.');
  }
  if (env.NODE_ENV === 'production' && rateLimitStore === 'memory') {
    throw new Error('Production requires a shared RATE_LIMIT_STORE such as mongodb.');
  }

  const paymentProvider = (env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (!['mock', 'razorpay'].includes(paymentProvider)) {
    throw new Error('PAYMENT_PROVIDER must be mock or razorpay.');
  }
  if (env.NODE_ENV === 'production' && paymentProvider !== 'razorpay') {
    throw new Error('Production requires PAYMENT_PROVIDER=razorpay.');
  }
  if (paymentProvider === 'razorpay' &&
    (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)) {
    throw new Error('Razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET.');
  }

  return { port, paymentProvider, rateLimitStore };
}

module.exports = { loadEnvironment, validateEnvironment };
