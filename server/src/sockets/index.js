const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Delivery = require('../models/Delivery');

function socketOrigins() {
  return (process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: socketOrigins(), credentials: true }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) return next(new Error('Authentication required'));

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next(new Error('Invalid or expired access token'));
    }

    let user;
    try {
      user = await User.findById(payload.sub).select('_id role active tokenVersion');
    } catch (error) {
      return next(error);
    }
    if (!user || !user.active) return next(new Error('Account is unavailable'));
    if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) return next(new Error('Session has expired'));
    socket.data.user = { id: String(user._id), role: user.role };
    return next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.on('join_delivery', async (deliveryId, callback) => {
      try {
        if (typeof deliveryId !== 'string' || !/^[a-f\d]{24}$/i.test(deliveryId)) {
          return callback?.({ success: false, message: 'Invalid delivery ID' });
        }
        const delivery = await Delivery.findById(deliveryId).select('customer owner transporter assignedBy');
        const userId = socket.data.user.id;
        const authorized = socket.data.user.role === 'admin' || [
          delivery?.customer, delivery?.owner, delivery?.transporter
        ].some((value) => String(value || '') === userId);
        if (!authorized) return callback?.({ success: false, message: 'Forbidden' });
        socket.join(`delivery:${deliveryId}`);
        return callback?.({ success: true });
      } catch {
        return callback?.({ success: false, message: 'Unable to join delivery updates' });
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer };
