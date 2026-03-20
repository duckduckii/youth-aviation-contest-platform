const bcrypt = require('bcryptjs');

async function hashPassword(rawPassword) {
  return bcrypt.hash(rawPassword, 10);
}

async function verifyPassword(rawPassword, hashedPassword) {
  return bcrypt.compare(rawPassword, hashedPassword);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
