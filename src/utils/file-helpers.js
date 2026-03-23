const fs = require('fs/promises');
const path = require('path');

function sanitizeWorkTitle(title) {
  const raw = (title || '').trim();
  return raw.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function extOf(filename) {
  return path.extname(filename || '').toLowerCase();
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function timestampToken() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

function archiveFieldToken(fieldKey) {
  if (fieldKey === 'report') return 'report';
  if (fieldKey === 'proof1') return 'proof1';
  if (fieldKey === 'proof2') return 'proof2';
  return 'integrity';
}

function buildArchiveBaseName(registrationNo, fieldKey) {
  const safeRegistrationNo = String(registrationNo || 'unknown').replace(/[^0-9a-zA-Z_-]/g, '');
  return `${safeRegistrationNo}_innovation_${archiveFieldToken(fieldKey)}_${timestampToken()}`;
}

function buildStoredName(registrationNo, fieldKey, ext) {
  return `${buildArchiveBaseName(registrationNo, fieldKey)}${ext}`;
}

function buildPhysicalName(registrationNo, fieldKey, ext) {
  return `${buildArchiveBaseName(registrationNo, fieldKey)}${ext}`;
}

module.exports = {
  sanitizeWorkTitle,
  extOf,
  ensureDir,
  removeFile,
  buildStoredName,
  buildPhysicalName,
};
