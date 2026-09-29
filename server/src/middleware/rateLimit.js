const crypto = require('crypto');
const RateLimitBucket = require('../models/RateLimitBucket');
const { AppError } = require('../utils/api');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 120;
const MAX_BUCKETS = 10000;
const requestBuckets = new Map();
let lastSweep = 0;

function hitMemoryBucket(address, now) {
  if (now - lastSweep > WINDOW_MS) {
    for (const [bucketAddress, bucket] of requestBuckets) {
      if (now - bucket.start > WINDOW_MS) requestBuckets.delete(bucketAddress);
    }
    lastSweep = now;
  }
  const bucket = requestBuckets.get(address) || { start: now, count: 0 };
  if (now - bucket.start > WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  if (!requestBuckets.has(address) && requestBuckets.size >= MAX_BUCKETS) {
    const oldest = requestBuckets.keys().next().value;
    if (oldest) requestBuckets.delete(oldest);
  }
  requestBuckets.set(address, bucket);
  return bucket.count;
}

async function hitMongoBucket(address, now) {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const bucketKey = crypto.createHash('sha256').update(`${address}:${windowStart}`).digest('hex');
  const expiresAt = new Date(windowStart + WINDOW_MS * 2);
  const filter = { bucketKey };
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { expiresAt }
  };

  try {
    const bucket = await RateLimitBucket.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });
    return bucket.count;
  } catch (error) {
    if (error.code !== 11000) throw error;
    const bucket = await RateLimitBucket.findOneAndUpdate(filter, { $inc: { count: 1 } }, { new: true });
    if (!bucket) throw new Error('Rate-limit bucket disappeared during concurrent update');
    return bucket.count;
  }
}

function rateLimit(req, res, next) {
  if (req.path === '/api/health' || req.path === '/api/ready') return next();
  const address = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const mode = process.env.RATE_LIMIT_STORE || (process.env.NODE_ENV === 'production' ? 'mongodb' : 'memory');

  if (mode === 'memory') {
    return respond(hitMemoryBucket(address, now), res, next);
  }
  if (mode !== 'mongodb') return next(new Error(`Unsupported RATE_LIMIT_STORE: ${mode}`));
  return hitMongoBucket(address, now)
    .then((count) => respond(count, res, next))
    .catch(next);
}

function respond(count, res, next) {
  if (count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down.',
      errorCode: 'RATE_LIMITED'
    });
  }
  return next();
}

module.exports = rateLimit;
