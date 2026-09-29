const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const bookingRoutes = require('./routes/bookings');
const ownerRoutes = require('./routes/owner');
const adminRoutes = require('./routes/admin');
const swapRoutes = require('./routes/swaps');
const packageRoutes = require('./routes/packages');
const notificationRoutes = require('./routes/notifications');
const { users, payments } = require('./routes/users');
const searchRoutes = require('./routes/search');
const razorpayWebhookRoutes = require('./routes/razorpayWebhook');
const requestId = require('./middleware/requestId');
const rateLimit = require('./middleware/rateLimit');
const readiness = require('./middleware/readiness');
const health = require('./middleware/health');
const { notFound, errorHandler } = require('./utils/api');

const app = express();
app.disable('x-powered-by');
app.use(requestId);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
}
app.set('trust proxy', trustProxyHops);
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  credentials: true
}));
app.use(rateLimit);
app.use('/api/payments/razorpay/webhook', razorpayWebhookRoutes);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', health);
app.get('/api/ready', readiness);
app.use('/api/v1', searchRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api', ownerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/swaps', swapRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', users);
app.use('/api/payments', payments);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
