const express = require('express');
const Notification = require('../models/Notification');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { objectId } = require('../utils/validation');

const router = express.Router();
router.use(protect);

router.get('/', asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(100);
  return sendSuccess(res, 'Notifications', notifications);
}));

router.patch('/:id/read', objectId(), validate, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user.id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw new AppError('Notification not found', 404, 'NOT_FOUND');
  return sendSuccess(res, 'Notification marked read', notification);
}));

module.exports = router;
