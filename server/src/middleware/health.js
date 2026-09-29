const mongoose = require('mongoose');

function health(req, res) {
  return res.json({
    success: true,
    message: 'RentalHub API is running',
    data: {
      status: 'running',
      db: { state: mongoose.connection.readyState },
      uptimeSeconds: Number((process.uptime() || 0).toFixed(2))
    }
  });
}

module.exports = health;
