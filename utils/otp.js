const crypto = require('crypto');

function generateOTP() {
  return String(Math.floor(100000 + crypto.randomInt(900000)));
}

function hashOTP(otp, userId) {
  return crypto.createHash('sha256').update(otp + '|' + userId).digest('hex');
}

function verifyOTP(otp, userId, storedHash) {
  const expected = hashOTP(otp, userId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(storedHash));
}

module.exports = { generateOTP, hashOTP, verifyOTP };
