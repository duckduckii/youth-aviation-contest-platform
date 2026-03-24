const fs = require('fs/promises');
const path = require('path');

const { query } = require('../db');

const EXPORT_BATCH_STATUS = {
  PACKAGING: 'PACKAGING',
  READY: 'READY',
  DOWNLOADED: 'DOWNLOADED',
  FAILED: 'FAILED',
};

function toInt(value, fallback = 0) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function parseBatch(row) {
  if (!row) return null;
  return {
    ...row,
    batch_no: Number(row.batch_no) || 0,
    item_count: Number(row.item_count) || 0,
  };
}

async function getConfig() {
  const rows = await query('SELECT * FROM export_batch_configs ORDER BY id ASC LIMIT 1');
  const row = rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    batch_size: Number(row.batch_size) || 0,
  };
}

async function upsertConfig({ batchSize, createdBy }) {
  const safeBatchSize = Math.max(1, Math.min(toInt(batchSize, 1000), 50000));
  const existing = await getConfig();
  if (existing) {
    await query(
      `UPDATE export_batch_configs
       SET batch_size = :batchSize,
           created_by = :createdBy
       WHERE id = :id`,
      {
        id: existing.id,
        batchSize: safeBatchSize,
        createdBy,
      },
    );
    return getConfig();
  }

  await query(
    `INSERT INTO export_batch_configs (batch_size, created_by)
     VALUES (:batchSize, :createdBy)`,
    {
      batchSize: safeBatchSize,
      createdBy,
    },
  );
  return getConfig();
}

async function cleanupBatchArtifacts(batches) {
  const dirs = new Set();

  for (const batch of batches) {
    if (batch.archive_path) {
      dirs.add(path.dirname(batch.archive_path));
    }
    if (batch.manifest_path) {
      dirs.add(path.dirname(batch.manifest_path));
    }
  }

  for (const dirPath of dirs) {
    try {
      // Remove old packaged files after a full batch rebuild.
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

async function getTotalSubmittedCount() {
  const rows = await query(`
    SELECT COUNT(*) AS count
    FROM users u
    INNER JOIN submissions s ON s.user_id = u.id
    WHERE u.registration_no NOT IN ('admin', 'test')
      AND u.direction = 'INNOVATION'
      AND s.status = 'SUBMITTED'
  `);
  return Number(rows[0]?.count) || 0;
}

async function listBatches() {
  const rows = await query('SELECT * FROM export_batches ORDER BY batch_no ASC');
  return rows.map(parseBatch);
}

async function getBatchById(id) {
  const rows = await query('SELECT * FROM export_batches WHERE id = :id LIMIT 1', { id });
  return parseBatch(rows[0] || null);
}

async function getUnassignedSubmittedUsers(limit) {
  const safeLimit = Math.max(1, Math.min(toInt(limit, 1000), 50000));
  return query(
    `SELECT
      u.id AS user_id,
      u.registration_no,
      s.submitted_at
    FROM users u
    INNER JOIN submissions s ON s.user_id = u.id
    LEFT JOIN export_batch_items ebi ON ebi.user_id = u.id
    WHERE u.registration_no NOT IN ('admin', 'test')
      AND u.direction = 'INNOVATION'
      AND s.status = 'SUBMITTED'
      AND ebi.user_id IS NULL
    ORDER BY s.submitted_at ASC, u.id ASC
    LIMIT ${safeLimit}`,
  );
}

async function getTailCount() {
  const rows = await query(`
    SELECT COUNT(*) AS count
    FROM users u
    INNER JOIN submissions s ON s.user_id = u.id
    LEFT JOIN export_batch_items ebi ON ebi.user_id = u.id
    WHERE u.registration_no NOT IN ('admin', 'test')
      AND u.direction = 'INNOVATION'
      AND s.status = 'SUBMITTED'
      AND ebi.user_id IS NULL
  `);
  return Number(rows[0]?.count) || 0;
}

async function listTailUsers() {
  return query(
    `SELECT
      u.id AS user_id,
      u.registration_no,
      s.work_title,
      s.submitted_at,
      s.report_file_path,
      s.report_original_name,
      s.report_stored_name,
      s.report_file_size,
      s.proof1_file_path,
      s.proof1_original_name,
      s.proof1_stored_name,
      s.proof1_file_size,
      s.proof2_file_path,
      s.proof2_original_name,
      s.proof2_stored_name,
      s.proof2_file_size,
      s.integrity_file_path,
      s.integrity_original_name,
      s.integrity_stored_name,
      s.integrity_file_size
    FROM users u
    INNER JOIN submissions s ON s.user_id = u.id
    LEFT JOIN export_batch_items ebi ON ebi.user_id = u.id
    WHERE u.registration_no NOT IN ('admin', 'test')
      AND u.direction = 'INNOVATION'
      AND s.status = 'SUBMITTED'
      AND ebi.user_id IS NULL
    ORDER BY s.submitted_at ASC, u.id ASC`,
  );
}

async function createBatchFromUsers(users) {
  if (!users || users.length === 0) {
    throw new Error('创建 batch 需要至少一条资料');
  }

  const rows = await query('SELECT COALESCE(MAX(batch_no), 0) AS max_batch_no FROM export_batches');
  const nextBatchNo = (Number(rows[0]?.max_batch_no) || 0) + 1;

  const result = await query(
    `INSERT INTO export_batches (
      batch_no,
      item_count,
      start_registration_no,
      end_registration_no,
      status
    ) VALUES (
      :batchNo,
      :itemCount,
      :startRegistrationNo,
      :endRegistrationNo,
      :status
    )`,
    {
      batchNo: nextBatchNo,
      itemCount: users.length,
      startRegistrationNo: users[0].registration_no,
      endRegistrationNo: users[users.length - 1].registration_no,
      status: EXPORT_BATCH_STATUS.READY,
    },
  );

  const batchId = result.insertId;
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO export_batch_items (batch_id, user_id, seq_no)
       VALUES (:batchId, :userId, :seqNo)`,
      {
        batchId,
        userId: user.user_id,
        seqNo: index + 1,
      },
    );
  }

  return getBatchById(batchId);
}

async function syncFrozenBatches() {
  const config = await getConfig();
  if (!config || !config.batch_size) {
    return [];
  }

  const created = [];
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const users = await getUnassignedSubmittedUsers(config.batch_size);
    if (users.length < config.batch_size) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const batch = await createBatchFromUsers(users);
    created.push(batch);
  }

  return created;
}

async function rebuildFrozenBatches({ batchSize, createdBy }) {
  const existingBatches = await listBatches();

  await upsertConfig({ batchSize, createdBy });
  await query('DELETE FROM export_batches');
  await cleanupBatchArtifacts(existingBatches);

  return syncFrozenBatches();
}

async function listBatchUsers(batchId) {
  return query(
    `SELECT
      ebi.seq_no,
      u.id AS user_id,
      u.registration_no,
      s.work_title,
      s.submitted_at,
      s.report_file_path,
      s.report_original_name,
      s.report_stored_name,
      s.report_file_size,
      s.proof1_file_path,
      s.proof1_original_name,
      s.proof1_stored_name,
      s.proof1_file_size,
      s.proof2_file_path,
      s.proof2_original_name,
      s.proof2_stored_name,
      s.proof2_file_size,
      s.integrity_file_path,
      s.integrity_original_name,
      s.integrity_stored_name,
      s.integrity_file_size
    FROM export_batch_items ebi
    INNER JOIN users u ON u.id = ebi.user_id
    INNER JOIN submissions s ON s.user_id = u.id
    WHERE ebi.batch_id = :batchId
    ORDER BY ebi.seq_no ASC`,
    { batchId },
  );
}

async function markReady(batchId, payload) {
  await query(
    `UPDATE export_batches
     SET status = :status,
         archive_path = :archivePath,
         manifest_path = :manifestPath,
         error_message = NULL,
         packaged_at = NOW()
     WHERE id = :batchId`,
    {
      batchId,
      status: EXPORT_BATCH_STATUS.READY,
      archivePath: payload.archivePath || null,
      manifestPath: payload.manifestPath || null,
    },
  );
}

async function markFailed(batchId, errorMessage) {
  await query(
    `UPDATE export_batches
     SET status = :status, error_message = :errorMessage
     WHERE id = :batchId`,
    {
      batchId,
      status: EXPORT_BATCH_STATUS.FAILED,
      errorMessage: String(errorMessage || '打包失败').slice(0, 500),
    },
  );
}

async function markDownloaded(batchId) {
  await query(
    `UPDATE export_batches
     SET status = :status, downloaded_at = NOW()
     WHERE id = :batchId`,
    {
      batchId,
      status: EXPORT_BATCH_STATUS.DOWNLOADED,
    },
  );
}

function buildBarSegments(batches, tailCount) {
  return [
    ...batches.map((batch) => ({
      type: batch.status === EXPORT_BATCH_STATUS.DOWNLOADED ? 'downloaded' : 'frozen',
      batchId: batch.id,
      batchNo: batch.batch_no,
      count: batch.item_count,
    })),
    ...(tailCount > 0 ? [{
      type: 'tail',
      batchId: null,
      batchNo: null,
      count: tailCount,
    }] : []),
  ];
}

async function getPageData() {
  const [config, totalSubmitted, batches, tailCount] = await Promise.all([
    getConfig(),
    getTotalSubmittedCount(),
    listBatches(),
    getTailCount(),
  ]);

  const tailUsers = tailCount > 0 ? await listTailUsers() : [];
  const tailBatch = tailUsers.length > 0 ? {
    id: 'tail',
    item_count: tailUsers.length,
    start_registration_no: tailUsers[0].registration_no,
    end_registration_no: tailUsers[tailUsers.length - 1].registration_no,
  } : null;

  return {
    config,
    totalSubmitted,
    batches,
    tailCount,
    tailBatch,
    barSegments: buildBarSegments(batches, tailCount),
  };
}

module.exports = {
  EXPORT_BATCH_STATUS,
  getConfig,
  upsertConfig,
  rebuildFrozenBatches,
  listBatches,
  getBatchById,
  listBatchUsers,
  listTailUsers,
  syncFrozenBatches,
  getTailCount,
  getPageData,
  markReady,
  markFailed,
  markDownloaded,
  createBatchFromUsers,
};
