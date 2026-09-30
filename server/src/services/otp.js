const crypto = require('node:crypto');

function createCode() {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(code, salt, 32).toString('hex');
  return { code, salt, hash };
}

function verifyCode(code, salt, expectedHash) {
  if (!/^\d{6}$/.test(String(code)) || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) return false;
  const actualHash = crypto.scryptSync(String(code), salt, 32);
  const storedHash = Buffer.from(expectedHash, 'hex');
  return actualHash.length === storedHash.length && crypto.timingSafeEqual(actualHash, storedHash);
}

module.exports = { createCode, verifyCode };