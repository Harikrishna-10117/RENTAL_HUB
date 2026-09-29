const { validationResult } = require('express-validator');
const { AppError } = require('../utils/api');

function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return next(new AppError(result.array().map((entry) => entry.msg).join(', '), 400, 'VALIDATION_ERROR'));
  }
  next();
}

module.exports = validate;
