const { createLogger } = require('./logging');

class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
  }
}

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function sendSuccess(res, message, data, status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let statusCode = error.statusCode || 500;
  let errorCode = error.errorCode || 'INTERNAL_ERROR';
  let message = error.message || 'An unexpected error occurred';

  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = Object.values(error.errors).map((entry) => entry.message).join(', ');
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorCode = 'INVALID_ID';
    message = 'A supplied identifier is invalid';
  } else if (error.code === 11000) {
    statusCode = 409;
    errorCode = 'DUPLICATE_RESOURCE';
    message = 'A record with that unique value already exists';
  }

  if (statusCode >= 500) {
    createLogger({ requestId: req.id }).error('Request failed', {
      statusCode,
      errorCode,
      method: req.method,
      path: req.originalUrl,
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: error.stack })
    });
  }
  return res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    errorCode
  });
}

module.exports = { AppError, asyncHandler, sendSuccess, notFound, errorHandler };
