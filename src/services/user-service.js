const { query } = require('../db');
const { verifyPassword, hashPassword } = require('../utils/password');
const { TRACKS } = require('../constants');

async function findByRegistrationNo(registrationNo) {
  const rows = await query('SELECT * FROM users WHERE registration_no = :registrationNo LIMIT 1', {
    registrationNo,
  });
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function verifyLogin(registrationNo, password) {
  const user = await findByRegistrationNo(registrationNo);
  if (!user) return null;

  const pass = await verifyPassword(password, user.password_hash);
  if (!pass) return null;

  return user;
}

async function changePassword(userId, newPassword) {
  const newHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = :newHash WHERE id = :userId', {
    newHash,
    userId,
  });
}

async function setTrackOnce(userId, track) {
  if (![TRACKS.KNOWLEDGE, TRACKS.INNOVATION].includes(track)) {
    throw new Error('无效赛道类型');
  }

  const result = await query(
    'UPDATE users SET direction = :track WHERE id = :userId AND direction IS NULL',
    {
      track,
      userId,
    },
  );

  return result.affectedRows > 0;
}

module.exports = {
  findByRegistrationNo,
  findById,
  verifyLogin,
  changePassword,
  setTrackOnce,
};
