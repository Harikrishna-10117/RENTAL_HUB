const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w.:-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

module.exports = requestId;
