const Notification = require('../models/Notification');

async function notify(user, type, title, message, metadata = {}) {
  if (!user) return;
  await Notification.create({ user, type, title, message, metadata });
}

module.exports = notify;
