require('dotenv').config();
const app = require('./app');
const connectDatabase = require('./config/db');

const port = Number(process.env.PORT) || 5000;

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('Startup aborted: set JWT_SECRET to a random secret of at least 32 characters in server/.env.');
    process.exitCode = 1;
    return;
  }
  if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_STORE === 'memory') {
    console.error('Startup aborted: production requires a shared RATE_LIMIT_STORE such as mongodb.');
    process.exitCode = 1;
    return;
  }
  const paymentProvider = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (!['mock', 'razorpay'].includes(paymentProvider)) {
    console.error('Startup aborted: PAYMENT_PROVIDER must be mock or razorpay.');
    process.exitCode = 1;
    return;
  }
  if (process.env.NODE_ENV === 'production' && paymentProvider !== 'razorpay') {
    console.error('Startup aborted: production requires PAYMENT_PROVIDER=razorpay.');
    process.exitCode = 1;
    return;
  }
  if (paymentProvider === 'razorpay' &&
    (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET)) {
    console.error('Startup aborted: Razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET.');
    process.exitCode = 1;
    return;
  }
  let memoryServer;
  try {
    memoryServer = await connectDatabase();
  } catch (error) {
    console.error(`Startup aborted: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const server = app.listen(port, () => console.log(`RentalHub API listening on port ${port}`));
  const shutdown = async () => {
    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      if (memoryServer) await memoryServer.stop();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
