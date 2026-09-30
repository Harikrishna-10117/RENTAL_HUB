const { AppError } = require('../utils/api');

function isConfigured() {
  return Boolean(
    process.env.PASSWORD_RESET_PROVIDER_URL &&
    process.env.PASSWORD_RESET_PROVIDER_TOKEN &&
    process.env.PASSWORD_RESET_URL
  );
}

async function sendResetLink(email, token) {
  if (!isConfigured()) throw new AppError('Password reset service not configured', 503, 'PASSWORD_RESET_NOT_CONFIGURED');

  let resetUrl;
  try {
    resetUrl = new URL(process.env.PASSWORD_RESET_URL);
    resetUrl.searchParams.set('token', token);
  } catch {
    throw new AppError('Password reset service is not configured correctly', 503, 'PASSWORD_RESET_NOT_CONFIGURED');
  }

  let response;
  try {
    response = await fetch(`${process.env.PASSWORD_RESET_PROVIDER_URL.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.PASSWORD_RESET_PROVIDER_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ to: email, resetUrl: resetUrl.toString() })
    });
  } catch {
    throw new AppError('Password reset email provider is unavailable', 502, 'PASSWORD_RESET_PROVIDER_UNAVAILABLE');
  }
  if (!response.ok) throw new AppError('Password reset email could not be sent', 502, 'PASSWORD_RESET_PROVIDER_ERROR');
}

module.exports = { isConfigured, sendResetLink };