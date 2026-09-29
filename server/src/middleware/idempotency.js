const crypto = require('crypto');
const IdempotencyRecord = require('../models/IdempotencyRecord');
const { AppError } = require('../utils/api');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableRequestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: req.method,
    url: req.originalUrl,
    body: canonicalize(req.body || {})
  })).digest('hex');
}

function idempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return next(new AppError('A valid Idempotency-Key header is required for this operation', 400, 'IDEMPOTENCY_KEY_REQUIRED'));
  }
  if (!req.user?.id) return next(new AppError('Authentication is required for idempotent operations', 401, 'UNAUTHORIZED'));

  const principal = String(req.user.id);
  const scope = `${req.method}:${req.baseUrl}${req.path}`;
  const requestHash = stableRequestHash(req);
  let record;

  return IdempotencyRecord.create({
    principal,
    scope,
    key,
    requestHash,
    status: 'processing',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  }).then((created) => {
    record = created;
    const sendJson = res.json.bind(res);
    let finalizing = false;
    res.json = (body) => {
      if (finalizing) return sendJson(body);
      finalizing = true;
      const responseStatus = res.statusCode;
      if (responseStatus >= 500) {
        return IdempotencyRecord.deleteOne({ _id: record._id })
          .then(() => sendJson(body))
          .catch((error) => {
            res.json = sendJson;
            return next(error);
          });
      }
      return IdempotencyRecord.updateOne(
        { _id: record._id, status: 'processing' },
        { $set: { status: 'completed', responseStatus, responseBody: body } }
      ).then((result) => {
        if (result.matchedCount !== 1) throw new Error('Failed to persist the idempotent response');
        return sendJson(body);
      }).catch((error) => {
        res.json = sendJson;
        return next(error);
      });
    };
    return next();
  }).catch(async (error) => {
    if (error.code !== 11000) return next(error);
    try {
      const existing = await IdempotencyRecord.findOne({ principal, scope, key });
      if (!existing) return next(error);
      if (existing.requestHash !== requestHash) {
        return next(new AppError('Idempotency-Key was already used with a different request', 409, 'IDEMPOTENCY_CONFLICT'));
      }
      if (existing.status !== 'completed') {
        return next(new AppError('A request with this Idempotency-Key is still processing', 409, 'IDEMPOTENCY_IN_PROGRESS'));
      }
      return res.status(existing.responseStatus).json(existing.responseBody);
    } catch (lookupError) {
      return next(lookupError);
    }
  });
}

module.exports = idempotency;
