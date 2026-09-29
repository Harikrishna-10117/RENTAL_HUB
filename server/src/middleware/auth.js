const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../utils/api');

const protect = asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError('Invalid or expired access token', 401, 'INVALID_TOKEN');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active) throw new AppError('Account is unavailable', 401, 'ACCOUNT_UNAVAILABLE');
  req.user = user;
  next();
});

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403, 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = { protect, allowRoles };
