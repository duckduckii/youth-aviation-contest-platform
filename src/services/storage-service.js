const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const OSS = require('ali-oss');

const config = require('../config');
const { ensureDir, removeFile } = require('../utils/file-helpers');

function isOssDriver() {
  return config.storage.driver === 'oss';
}

function isLocalAbsolutePath(reference) {
  return Boolean(reference) && path.isAbsolute(reference);
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
  const endpointMode = options.endpointMode || 'default';
  let endpoint;

  if (endpointMode === 'public') {
    endpoint = config.oss.endpoint || undefined;
  } else if (endpointMode === 'internal') {
    endpoint = config.oss.internalEndpoint || config.oss.endpoint || undefined;
  } else {
    endpoint = config.oss.internalEndpoint || config.oss.endpoint || undefined;
  }

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
  const endpointMode = config.oss.directUploadEndpointMode === 'internal' ? 'internal' : 'public';
  const client = createOssClient({ endpointMode });
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
    endpointMode,
  };
}

async function putLocalFile({ absolutePath, buffer }) {
  await ensureDir(path.dirname(absolutePath));
  await fsPromises.writeFile(absolutePath, buffer);
}

async function putStoredBuffer({ reference, buffer }) {
  if (!reference) {
    throw new Error('存储引用不能为空');
  }

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
    await putLocalFile({ absolutePath: reference, buffer });
    return;
  }

  const client = createOssClient();
  await client.put(reference, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
}

async function removeStoredObject(reference) {
  if (!reference) return;

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
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

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
    try {
      await fsPromises.access(reference);
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

async function getStoredObjectSize(reference) {
  if (!reference) return 0;

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
    try {
      const stat = await fsPromises.stat(reference);
      return Number(stat.size) || 0;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  }

  const client = createOssClient();
  const result = await client.head(reference);
  const value = result?.res?.headers?.['content-length'];
  return Number.parseInt(value, 10) || 0;
}

async function createReadStream(reference) {
  if (!reference) {
    throw new Error('文件引用不能为空');
  }

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
    return fs.createReadStream(reference);
  }

  const client = createOssClient();
  const result = await client.getStream(reference);
  return result.stream;
}

async function fileExists(reference) {
  if (!reference) return false;

  if (!isOssDriver() || isLocalAbsolutePath(reference)) {
    try {
      await fsPromises.access(reference);
      return true;
    } catch (error) {
      return false;
    }
  }

  return hasStoredObject(reference);
}

function isExpectedObjectKey(registrationNo, fieldKey, objectKey) {
  return String(objectKey || '').startsWith(`${objectPrefix(registrationNo, fieldKey)}/`);
}

module.exports = {
  isOssDriver,
  putLocalFile,
  putStoredBuffer,
  signDirectUpload,
  removeStoredObject,
  hasStoredObject,
  getStoredObjectSize,
  createReadStream,
  fileExists,
  buildObjectKey,
  isExpectedObjectKey,
};
