const express = require('express');
const { SearchProvider } = require('../services/search');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
  const condition = typeof req.query.condition === 'string' ? req.query.condition : '';
  const minRate = req.query.minRate !== undefined ? Number(req.query.minRate) : null;
  const maxRate = req.query.maxRate !== undefined ? Number(req.query.maxRate) : null;
  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
  const equipmentType = typeof req.query.equipmentType === 'string' ? req.query.equipmentType.trim() : '';
  const operatorRequired = typeof req.query.operatorRequired === 'string' ? req.query.operatorRequired : undefined;
  const transportRequired = typeof req.query.transportRequired === 'string' ? req.query.transportRequired : undefined;
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

  if (req.query.limit !== undefined && (!Number.isInteger(Number(req.query.limit)) || Number(req.query.limit) < 1 || Number(req.query.limit) > 50)) {
    throw new AppError('Pagination limit must be between 1 and 50 items', 400, 'INVALID_LIMIT');
  }

  const result = await SearchProvider.query({
    q, category, city, brand, sort, condition, minRate, maxRate, equipmentType,
    operatorRequired, transportRequired, startDate, endDate, page, limit
  });

  return sendSuccess(res, 'Search results', result);
}));

module.exports = router;
