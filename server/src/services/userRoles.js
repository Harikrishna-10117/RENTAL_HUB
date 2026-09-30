const User = require('../models/User');

async function normalizeUserRole(user) {
  if (user.role === 'inspector') {
    await User.updateOne({ _id: user._id, role: 'inspector' }, { $set: { role: 'transporter' } });
    user.role = 'transporter';
  }
  return user;
}

module.exports = { normalizeUserRole };