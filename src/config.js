const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function intFromEnv(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? defaultValue : value;
}

const rootDir = process.cwd();

module.exports = {
  app: {
    host: process.env.HOST || '0.0.0.0',
    port: intFromEnv('PORT', 3000),
    sessionSecret: process.env.SESSION_SECRET || 'contest-platform-dev-secret',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: intFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'youth_aviation_contest',
    connectionLimit: intFromEnv('DB_CONNECTION_LIMIT', 10),
  },
  upload: {
    rootDir: path.join(rootDir, 'uploads'),
    maxReportMb: intFromEnv('MAX_REPORT_MB', 30),
    maxProof1Mb: intFromEnv('MAX_PROOF1_MB', 30),
    maxProof2Mb: intFromEnv('MAX_PROOF2_MB', 100),
    maxIntegrityMb: intFromEnv('MAX_INTEGRITY_MB', 30),
  },
};
