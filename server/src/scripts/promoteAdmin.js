require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const connectDatabase = require('../config/db');

async function promoteAdmin(email) {
  if (!email || email === '--help') {
    console.log('Usage: npm run admin:promote -- <registered-email>');
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Provide a valid email address for an existing account.');
  }

  await connectDatabase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new Error(`No account found for ${normalizedEmail}. Register the account before promoting it.`);
  if (!user.active) throw new Error('Inactive accounts cannot be promoted.');

  if (user.role !== 'admin') {
    user.role = 'admin';
    user.tokenVersion += 1;
    await user.save();
  }

  console.log(`Administrator access is ready for ${normalizedEmail}. Sign in again to refresh the session.`);
}

if (require.main === module) {
  promoteAdmin(process.argv[2])
    .catch((error) => {
      console.error(`Admin setup failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

module.exports = promoteAdmin;