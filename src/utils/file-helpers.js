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
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function buildStoredName(fieldKey, workTitle) {
  const safeTitle = sanitizeWorkTitle(workTitle) || '未命名作品';
  if (fieldKey === 'report') return `${safeTitle}.pdf`;
  if (fieldKey === 'proof1') return `${safeTitle}证明材料1.pdf`;
  if (fieldKey === 'proof2') return `${safeTitle}证明材料2.mp4`;
  return `${safeTitle}诚信承诺书.pdf`;
}

function buildPhysicalName(fieldKey, ext) {
  return `${fieldKey}_${timestampToken()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
}

module.exports = {
  sanitizeWorkTitle,
  extOf,
  ensureDir,
  removeFile,
  buildStoredName,
  buildPhysicalName,
};
