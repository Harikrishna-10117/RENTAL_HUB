const { body, param, query } = require('express-validator');

const objectId = (field = 'id') => param(field).isMongoId().withMessage(`${field} must be a valid ID`);
const dateRange = [
  query('startDate').isISO8601().withMessage('startDate must be an ISO date'),
  query('endDate').isISO8601().withMessage('endDate must be an ISO date')
];
const bookingDateRange = [
  body('startDate').isISO8601().withMessage('startDate must be an ISO date'),
  body('endDate').isISO8601().withMessage('endDate must be an ISO date')
];

module.exports = { body, param, query, objectId, dateRange, bookingDateRange };
