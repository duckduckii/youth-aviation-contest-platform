const { query } = require('../db');
const { TRACKS } = require('../constants');

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function toPercent(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateLabel(date) {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${m}/${d}`;
}

function directionLabel(direction) {
  if (direction === TRACKS.KNOWLEDGE) return '知识类';
  if (direction === TRACKS.INNOVATION) return '创新设计类';
  return '未选择';
}

function submissionLabel(direction, status) {
  if (direction !== TRACKS.INNOVATION) return '--';
  if (status === 'SUBMITTED') return '已提交';
  if (status === 'DRAFT') return '草稿中';
  return '未开始';
}

function submissionStatusClass(direction, status) {
  if (direction !== TRACKS.INNOVATION) return 'neutral';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'DRAFT') return 'draft';
  return 'pending';
}

async function getOverview() {
  const rows = await query(`
    SELECT
      SUM(CASE WHEN registration_no NOT IN ('admin', 'test') THEN 1 ELSE 0 END) AS total_users,
      SUM(CASE WHEN registration_no NOT IN ('admin', 'test') AND direction IS NOT NULL THEN 1 ELSE 0 END) AS direction_selected,
      SUM(CASE WHEN registration_no NOT IN ('admin', 'test') AND direction IS NULL THEN 1 ELSE 0 END) AS direction_unselected,
      SUM(CASE WHEN registration_no NOT IN ('admin', 'test') AND direction = 'KNOWLEDGE' THEN 1 ELSE 0 END) AS knowledge_users,
      SUM(CASE WHEN registration_no NOT IN ('admin', 'test') AND direction = 'INNOVATION' THEN 1 ELSE 0 END) AS innovation_users
    FROM users
  `);

  const row = rows[0] || {};
  const totalUsers = toInt(row.total_users);
  const directionSelected = toInt(row.direction_selected);
  const directionUnselected = toInt(row.direction_unselected);
  const knowledgeUsers = toInt(row.knowledge_users);
  const innovationUsers = toInt(row.innovation_users);

  return {
    totalUsers,
    directionSelected,
    directionUnselected,
    knowledgeUsers,
    innovationUsers,
    directionSelectedRate: toPercent(directionSelected, totalUsers),
  };
}

async function getInnovationStats() {
  const rows = await query(`
    SELECT
      COUNT(*) AS innovation_total,
      SUM(CASE WHEN s.user_id IS NULL THEN 1 ELSE 0 END) AS innovation_not_started,
      SUM(CASE WHEN s.status = 'DRAFT' THEN 1 ELSE 0 END) AS innovation_draft,
      SUM(CASE WHEN s.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS innovation_submitted,
      SUM(CASE WHEN s.report_file_path IS NOT NULL THEN 1 ELSE 0 END) AS report_uploaded,
      SUM(CASE WHEN s.proof1_file_path IS NOT NULL THEN 1 ELSE 0 END) AS proof1_uploaded,
      SUM(CASE WHEN s.proof2_file_path IS NOT NULL THEN 1 ELSE 0 END) AS proof2_uploaded,
      SUM(CASE WHEN s.integrity_file_path IS NOT NULL THEN 1 ELSE 0 END) AS integrity_uploaded,
      SUM(
        CASE
          WHEN s.report_file_path IS NOT NULL
           AND s.proof1_file_path IS NOT NULL
           AND s.integrity_file_path IS NOT NULL
          THEN 1
          ELSE 0
        END
      ) AS required_complete,
      SUM(CASE WHEN s.status = 'SUBMITTED' AND DATE(s.submitted_at) = CURDATE() THEN 1 ELSE 0 END) AS submitted_today,
      SUM(
        CASE
          WHEN s.status = 'SUBMITTED'
           AND DATE(s.submitted_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
          THEN 1
          ELSE 0
        END
      ) AS submitted_yesterday
    FROM users u
    LEFT JOIN submissions s ON s.user_id = u.id
    WHERE u.registration_no NOT IN ('admin', 'test') AND u.direction = 'INNOVATION'
  `);

  const row = rows[0] || {};
  const total = toInt(row.innovation_total);
  const notStarted = toInt(row.innovation_not_started);
  const draft = toInt(row.innovation_draft);
  const submitted = toInt(row.innovation_submitted);
  const reportUploaded = toInt(row.report_uploaded);
  const proof1Uploaded = toInt(row.proof1_uploaded);
  const proof2Uploaded = toInt(row.proof2_uploaded);
  const integrityUploaded = toInt(row.integrity_uploaded);
  const requiredComplete = toInt(row.required_complete);
  const submittedToday = toInt(row.submitted_today);
  const submittedYesterday = toInt(row.submitted_yesterday);

  return {
    total,
    notStarted,
    draft,
    submitted,
    reportUploaded,
    proof1Uploaded,
    proof2Uploaded,
    integrityUploaded,
    requiredComplete,
    submittedToday,
    submittedYesterday,
    submittedRate: toPercent(submitted, total),
    requiredCompleteRate: toPercent(requiredComplete, total),
  };
}

async function getRecentTrend(days = 7) {
  const safeDays = Math.max(1, Math.min(toInt(days) || 7, 60));
  const offset = safeDays - 1;
  const rows = await query(`
      SELECT
        DATE_FORMAT(s.submitted_at, '%Y-%m-%d') AS day_key,
        COUNT(*) AS submit_count
      FROM submissions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE u.registration_no NOT IN ('admin', 'test')
        AND u.direction = 'INNOVATION'
        AND s.status = 'SUBMITTED'
        AND s.submitted_at >= DATE_SUB(CURDATE(), INTERVAL ${offset} DAY)
      GROUP BY DATE_FORMAT(s.submitted_at, '%Y-%m-%d')
      ORDER BY day_key ASC
    `);

  const countMap = new Map();
  rows.forEach((row) => {
    countMap.set(row.day_key, toInt(row.submit_count));
  });

  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = safeDays - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const key = formatDateKey(day);
    result.push({
      key,
      label: formatDateLabel(day),
      count: countMap.get(key) || 0,
    });
  }

  return result;
}

async function getRecentActivity(limit = 12) {
  const safeLimit = Math.max(1, Math.min(toInt(limit) || 12, 100));
  const rows = await query(`
      SELECT
        u.registration_no,
        u.direction,
        s.status AS submission_status,
        s.work_title,
        s.submitted_at,
        COALESCE(s.updated_at, u.updated_at) AS latest_at
      FROM users u
      LEFT JOIN submissions s ON s.user_id = u.id
      WHERE u.registration_no NOT IN ('admin', 'test')
      ORDER BY latest_at DESC
      LIMIT ${safeLimit}
    `);

  return rows.map((row) => ({
    registrationNo: row.registration_no,
    direction: row.direction,
    directionLabel: directionLabel(row.direction),
    submissionLabel: submissionLabel(row.direction, row.submission_status),
    submissionClass: submissionStatusClass(row.direction, row.submission_status),
    workTitle: row.work_title || '--',
    submittedAt: row.submitted_at || null,
    latestAt: row.latest_at || null,
  }));
}

async function getDashboardStats() {
  const [overview, innovation, recentTrend, recentActivity] = await Promise.all([
    getOverview(),
    getInnovationStats(),
    getRecentTrend(7),
    getRecentActivity(12),
  ]);

  return {
    overview,
    innovation,
    recentTrend,
    recentActivity,
    generatedAt: new Date(),
  };
}

module.exports = {
  getDashboardStats,
};
