const crypto = require('crypto');

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeMatch(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildAuthCookieValue(user, secret, ttlSeconds) {
  if (!user?.id || !secret) {
    return '';
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = encodePayload({
    id: user.id,
    registration_no: user.registration_no,
    direction: user.direction || null,
    iat: now,
    exp: now + ttlSeconds,
  });
  const signature = signValue(payload, secret);
  return `${payload}.${signature}`;
}

function verifyAuthCookieValue(value, secret) {
  if (!value || !secret) {
    return null;
  }

  const parts = String(value).split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  const expected = signValue(payload, secret);
  if (!timingSafeMatch(signature, expected)) {
    return null;
  }

  try {
    const decoded = decodePayload(payload);
    if (!decoded?.id || !decoded?.registration_no || !decoded?.exp) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) {
      return null;
    }

    return {
      id: decoded.id,
      registration_no: decoded.registration_no,
      direction: decoded.direction || null,
    };
  } catch (error) {
    return null;
  }
}

module.exports = {
  buildAuthCookieValue,
  verifyAuthCookieValue,
};
