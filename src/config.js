const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function intFromEnv(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? defaultValue : value;
}

function boolFromEnv(key, defaultValue = false) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const rootDir = process.cwd();

module.exports = {
  app: {
    host: process.env.HOST || '0.0.0.0',
    port: intFromEnv('PORT', 3000),
    workers: intFromEnv('APP_WORKERS', 0),
    requestLogEnabled: boolFromEnv('ACCESS_LOG_ENABLED', true),
    requestLogSlowMs: intFromEnv('ACCESS_LOG_SLOW_MS', 1500),
    sessionSecret: process.env.SESSION_SECRET || 'contest-platform-dev-secret',
    trustProxy: boolFromEnv('TRUST_PROXY', false),
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: intFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'youth_aviation_contest',
    connectionLimit: intFromEnv('DB_CONNECTION_LIMIT', 10),
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
  },
  redis: {
    url: process.env.REDIS_URL || '',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: intFromEnv('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || '',
    db: intFromEnv('REDIS_DB', 0),
    prefix: process.env.REDIS_PREFIX || 'youth-contest:sess:',
    sessionTtl: intFromEnv('SESSION_TTL', 60 * 60 * 8),
  },
  session: {
    cookieSecure: boolFromEnv('SESSION_COOKIE_SECURE', false),
  },
  upload: {
    rootDir: path.join(rootDir, 'uploads'),
    maxReportMb: intFromEnv('MAX_REPORT_MB', 30),
    maxProof1Mb: intFromEnv('MAX_PROOF1_MB', 30),
    maxProof2Mb: intFromEnv('MAX_PROOF2_MB', 100),
    maxIntegrityMb: intFromEnv('MAX_INTEGRITY_MB', 30),
  },
  oss: {
    region: process.env.OSS_REGION || '',
    bucket: process.env.OSS_BUCKET || '',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    endpoint: process.env.OSS_ENDPOINT || '',
    internalEndpoint: process.env.OSS_INTERNAL_ENDPOINT || '',
    directUploadEndpointMode: (process.env.OSS_DIRECT_UPLOAD_ENDPOINT_MODE || 'public').toLowerCase(),
    prefix: (process.env.OSS_PREFIX || 'contest').replace(/^\/+|\/+$/g, ''),
    signedUrlExpires: intFromEnv('OSS_SIGNED_URL_EXPIRES', 900),
    secure: boolFromEnv('OSS_SECURE', true),
    cname: boolFromEnv('OSS_CNAME', false),
  },
};
