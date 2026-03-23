const fs = require('fs/promises');
const path = require('path');
const OSS = require('ali-oss');

const config = require('../config');
const { ensureDir, removeFile } = require('../utils/file-helpers');

function isOssDriver() {
  return config.storage.driver === 'oss';
}

function assertOssConfigured() {
  const missing = [];
  if (!config.oss.region && !config.oss.endpoint) missing.push('OSS_REGION/OSS_ENDPOINT');
  if (!config.oss.bucket) missing.push('OSS_BUCKET');
  if (!config.oss.accessKeyId) missing.push('OSS_ACCESS_KEY_ID');
  if (!config.oss.accessKeySecret) missing.push('OSS_ACCESS_KEY_SECRET');
  if (missing.length > 0) {
    throw new Error(`OSS 配置缺失：${missing.join('、')}`);
  }
}

function createOssClient(options = {}) {
  assertOssConfigured();
  const usePublicEndpoint = options.publicEndpoint === true;
  const endpoint = usePublicEndpoint
    ? (config.oss.endpoint || undefined)
    : (config.oss.internalEndpoint || config.oss.endpoint || undefined);

  return new OSS({
    region: config.oss.region || undefined,
    endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket: config.oss.bucket,
    secure: config.oss.secure,
    cname: config.oss.cname,
  });
}

function objectPrefix(registrationNo, fieldKey) {
  return [config.oss.prefix, 'innovation', String(registrationNo), fieldKey].filter(Boolean).join('/');
}

function buildObjectKey(registrationNo, fieldKey, storedName) {
  return `${objectPrefix(registrationNo, fieldKey)}/${storedName}`;
}

async function signDirectUpload({ registrationNo, fieldKey, storedName, contentType }) {
  const client = createOssClient({ publicEndpoint: true });
  const objectKey = buildObjectKey(registrationNo, fieldKey, storedName);
  const uploadUrl = client.signatureUrl(objectKey, {
    expires: config.oss.signedUrlExpires,
    method: 'PUT',
    'Content-Type': contentType,
  });

  return {
    objectKey,
    uploadUrl,
    headers: {
      'Content-Type': contentType,
    },
    expiresIn: config.oss.signedUrlExpires,
  };
}

async function putLocalFile({ absolutePath, buffer }) {
  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, buffer);
}

async function removeStoredObject(reference) {
  if (!reference) return;

  if (!isOssDriver()) {
    await removeFile(reference);
    return;
  }

  const client = createOssClient();
  try {
    await client.delete(reference);
  } catch (error) {
    if (error.code !== 'NoSuchKey' && error.status !== 404) {
      throw error;
    }
  }
}

async function hasStoredObject(reference) {
  if (!reference) return false;

  if (!isOssDriver()) {
    try {
      await fs.access(reference);
      return true;
    } catch (error) {
      return false;
    }
  }

  const client = createOssClient();
  try {
    await client.head(reference);
    return true;
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.status === 404) {
      return false;
    }
    throw error;
  }
}

function isExpectedObjectKey(registrationNo, fieldKey, objectKey) {
  return String(objectKey || '').startsWith(`${objectPrefix(registrationNo, fieldKey)}/`);
}

module.exports = {
  isOssDriver,
  putLocalFile,
  signDirectUpload,
  removeStoredObject,
  hasStoredObject,
  buildObjectKey,
  isExpectedObjectKey,
};
