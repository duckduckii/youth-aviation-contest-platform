const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const archiver = require('archiver');

const config = require('../config');
const storageService = require('./storage-service');
const submissionService = require('./submission-service');
const exportBatchService = require('./export-batch-service');
const { ensureDir, removeFile } = require('../utils/file-helpers');

const FILE_RULES = [
  ['report', '01_作品研究设计报告.pdf'],
  ['proof1', '02_其他证明材料1.pdf'],
  ['proof2', '03_其他证明材料2.mp4'],
  ['integrity', '04_诚信承诺书.pdf'],
];

function exportRootDir() {
  return path.join(config.upload.rootDir, '__admin_exports');
}

function batchToken(batch) {
  return `batch-${String(batch.batch_no).padStart(6, '0')}-id-${String(batch.id).padStart(6, '0')}`;
}

function batchDir(batch) {
  return path.join(exportRootDir(), batchToken(batch));
}

function archivePath(batch) {
  return path.join(batchDir(batch), `${batchToken(batch)}.zip`);
}

function manifestPath(batch) {
  return path.join(batchDir(batch), `${batchToken(batch)}-manifest.csv`);
}

function tailToken() {
  return 'tail-current';
}

function tailDir() {
  return path.join(exportRootDir(), tailToken());
}

function tailArchivePath() {
  return path.join(tailDir(), `${tailToken()}.zip`);
}

function tailManifestPath() {
  return path.join(tailDir(), `${tailToken()}-manifest.csv`);
}

function registrationDir(registrationNo) {
  return String(registrationNo || 'unknown').replace(/[^0-9A-Za-z_-]/g, '_');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function resolveFileSize(row, key) {
  const reference = row[`${key}_file_path`];
  if (!reference) return 0;

  const currentSize = Number(row[`${key}_file_size`]) || 0;
  if (currentSize > 0) {
    return currentSize;
  }

  const size = await storageService.getStoredObjectSize(reference);
  if (size > 0) {
    await submissionService.updateByUserId(row.user_id, {
      [`${key}_file_size`]: size,
    });
  }
  return size;
}

async function buildFiles(row) {
  const result = [];
  for (const [key, archiveName] of FILE_RULES) {
    const reference = row[`${key}_file_path`];
    if (!reference) continue;
    // eslint-disable-next-line no-await-in-loop
    const size = await resolveFileSize(row, key);
    result.push({
      key,
      archiveName,
      reference,
      size,
      originalName: row[`${key}_original_name`] || '',
      storedName: row[`${key}_stored_name`] || '',
    });
  }
  return result;
}

function buildInfoJson(row, files) {
  return JSON.stringify({
    registrationNo: row.registration_no,
    workTitle: row.work_title || '',
    submittedAt: row.submitted_at,
    files: files.map((file) => ({
      fieldKey: file.key,
      originalName: file.originalName,
      storedName: file.storedName,
      size: file.size,
    })),
  }, null, 2);
}

async function buildArchive({ rows, archiveFile, manifestFile, manifestBatchNo }) {
  const manifestRows = [[
    'batch_no',
    'registration_no',
    'work_title',
    'submitted_at',
    'field_key',
    'original_name',
    'stored_name',
    'file_size',
    'zip_path',
  ].join(',')];

  const output = fs.createWriteStream(archiveFile);
  const archive = archiver('zip', {
    zlib: { level: 0 },
    forceZip64: true,
    store: true,
  });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const files = await buildFiles(row);
    const dirName = registrationDir(row.registration_no);

    archive.append(buildInfoJson(row, files), {
      name: `${dirName}/作品信息.json`,
    });

    for (const file of files) {
      const zipPath = `${dirName}/${file.archiveName}`;
      // eslint-disable-next-line no-await-in-loop
      const stream = await storageService.createReadStream(file.reference);
      stream.on('error', (error) => archive.emit('error', error));
      archive.append(stream, { name: zipPath });
      manifestRows.push([
        csvEscape(manifestBatchNo),
        csvEscape(row.registration_no),
        csvEscape(row.work_title || ''),
        csvEscape(row.submitted_at || ''),
        csvEscape(file.key),
        csvEscape(file.originalName),
        csvEscape(file.storedName),
        csvEscape(file.size),
        csvEscape(zipPath),
      ].join(','));
    }
  }

  const manifest = `${manifestRows.join('\n')}\n`;
  archive.append(manifest, { name: 'manifest.csv' });
  await fsPromises.writeFile(manifestFile, manifest, 'utf8');
  await archive.finalize();
  await done;
}

async function runExportBatch(batchId) {
  const batch = await exportBatchService.getBatchById(batchId);
  if (!batch) {
    throw new Error('Batch 不存在');
  }

  const users = await exportBatchService.listBatchUsers(batchId);
  if (users.length === 0) {
    throw new Error('Batch 没有关联资料');
  }

  const targetDir = batchDir(batch);
  const archiveFile = archivePath(batch);
  const manifestFile = manifestPath(batch);

  await ensureDir(targetDir);
  await removeFile(archiveFile);
  await removeFile(manifestFile);

  try {
    await buildArchive({
      rows: users,
      archiveFile,
      manifestFile,
      manifestBatchNo: batch.batch_no,
    });

    await exportBatchService.markReady(batchId, {
      archivePath: archiveFile,
      manifestPath: manifestFile,
    });
  } catch (error) {
    await removeFile(archiveFile);
    await removeFile(manifestFile);
    await exportBatchService.markFailed(batchId, error.message);
    throw error;
  }
}

async function runTailExport() {
  const users = await exportBatchService.listTailUsers();
  if (users.length === 0) {
    throw new Error('当前没有动态尾批资料');
  }

  const archiveFile = tailArchivePath();
  const manifestFile = tailManifestPath();

  await ensureDir(tailDir());
  await removeFile(archiveFile);
  await removeFile(manifestFile);

  try {
    await buildArchive({
      rows: users,
      archiveFile,
      manifestFile,
      manifestBatchNo: 'TAIL',
    });

    return {
      archivePath: archiveFile,
      manifestPath: manifestFile,
      itemCount: users.length,
    };
  } catch (error) {
    await removeFile(archiveFile);
    await removeFile(manifestFile);
    throw error;
  }
}

module.exports = {
  runExportBatch,
  runTailExport,
};
