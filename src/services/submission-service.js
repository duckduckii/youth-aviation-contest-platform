const { query } = require('../db');
const { SUBMISSION_STATUS } = require('../constants');

async function getByUserId(userId) {
  const rows = await query('SELECT * FROM submissions WHERE user_id = :userId LIMIT 1', { userId });
  return rows[0] || null;
}

async function getOrCreateByUserId(userId) {
  let row = await getByUserId(userId);
  if (row) return row;

  await query('INSERT INTO submissions (user_id) VALUES (:userId)', { userId });
  row = await getByUserId(userId);
  return row;
}

async function updateByUserId(userId, updates) {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const setSql = keys.map((k) => `${k} = :${k}`).join(', ');
  await query(`UPDATE submissions SET ${setSql} WHERE user_id = :userId`, {
    ...updates,
    userId,
  });
}

async function markSubmitted(userId) {
  await query(
    'UPDATE submissions SET status = :status, submitted_at = NOW() WHERE user_id = :userId',
    {
      userId,
      status: SUBMISSION_STATUS.SUBMITTED,
    },
  );
}

module.exports = {
  getByUserId,
  getOrCreateByUserId,
  updateByUserId,
  markSubmitted,
};
