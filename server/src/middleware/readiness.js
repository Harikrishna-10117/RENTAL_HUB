const mongoose = require('mongoose');

async function readiness(req, res) {
  const isReady = mongoose.connection.readyState === 1;
  return res.status(isReady ? 200 : 503).json({
    success: isReady,
    message: isReady ? 'RentalHub API is ready' : 'RentalHub database is not ready',
    data: {
      status: isReady ? 'ready' : 'starting',
      db: {
        state: mongoose.connection.readyState,
        name: mongoose.connection.name || null,
        host: mongoose.connection.host || null
      },
      uptimeSeconds: Number((process.uptime() || 0).toFixed(2))
    }
  });
}

module.exports = readiness;
