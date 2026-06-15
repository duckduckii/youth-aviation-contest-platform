const xlsx = require('xlsx');

const config = require('../config');
const { pool, query } = require('../db');
const { TRACKS, TRACK_LABELS } = require('../constants');
const { hashPassword } = require('../utils/password');

const REQUIRED_HEADERS = [
  '报名号',
  '学生姓名',
  '学校名称',
  '参赛形式',
  '手机号',
  '届次',
  '赛区',
  '赛事类型',
  '组别',
  '年级',
  '班级',
  '投递方式',
  '报名渠道',
  '团队名称',
  '指导老师',
  '审核状态',
  '提交时间',
  '审核时间',
];

const RESERVED_REGISTRATION_NOS = new Set(['admin', 'test']);
const IMPORT_BATCH_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
};
const PROGRESS_UPDATE_INTERVAL = 10;

const IMPORT_FIELD_MAP = {
  '学生姓名': 'student_name',
  '学校名称': 'school_name',
  '参赛形式': 'participation_mode',
  '手机号': 'mobile',
  '届次': 'season_name',
  '赛区': 'region_name',
  '赛事类型': 'event_name',
  '组别': 'group_name',
  '年级': 'grade_name',
  '班级': 'class_name',
  '投递方式': 'delivery_method',
  '报名渠道': 'registration_channel',
  '团队名称': 'team_name',
  '指导老师': 'mentor_name',
  '审核状态': 'review_status',
};

const USER_IMPORT_COLUMNS = [
  'student_name',
  'school_name',
  'participation_mode',
  'mobile',
  'season_name',
  'region_name',
  'event_name',
  'group_name',
  'grade_name',
  'class_name',
  'delivery_method',
  'registration_channel',
  'team_name',
  'mentor_name',
  'review_status',
  'external_submitted_at',
  'external_reviewed_at',
  'last_import_batch_id',
  'last_imported_at',
];

let schemaReadyPromise = null;

function normalizeText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function containsCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function normalizeSourceFileName(value) {
  const text = normalizeText(value);
  if (!text) {
    return 'import.xlsx';
  }

  if (containsCjk(text)) {
    return text;
  }

  const decoded = Buffer.from(text, 'latin1').toString('utf8').trim();
  if (decoded && containsCjk(decoded)) {
    return decoded;
  }

  return text;
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function isValidMobile(value) {
  const text = normalizeText(value);
  return !text || /^(?=.*\d)[\d*]{6,20}$/.test(text);
}

function normalizeDateTime(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    const hours = `${value.getHours()}`.padStart(2, '0');
    const minutes = `${value.getMinutes()}`.padStart(2, '0');
    const seconds = `${value.getSeconds()}`.padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  const text = normalizeText(value)
    .replace(/[T]/g, ' ')
    .replace(/[.].*$/, '')
    .replace(/\//g, '-');

  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    return `${text} 00:00:00`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(text)) {
    return `${text}:00`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2}$/.test(text)) {
    return text;
  }

  return null;
}

function initialPassword(registrationNo) {
  const text = normalizeText(registrationNo);
  return text.slice(-8);
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function addColumnIfMissing(conn, tableName, columnName, definitionSql) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [config.db.database, tableName, columnName],
  );

  if (Number(rows[0]?.count) > 0) {
    return;
  }

  try {
    await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }
}

async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const conn = await pool.getConnection();
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS registration_import_batches (
            id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
            source_file_name VARCHAR(255) NOT NULL,
            source_sheet_name VARCHAR(120) DEFAULT NULL,
            forced_direction VARCHAR(32) DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
            processed_rows INT UNSIGNED NOT NULL DEFAULT 0,
            total_rows INT UNSIGNED NOT NULL DEFAULT 0,
            success_rows INT UNSIGNED NOT NULL DEFAULT 0,
            failed_rows INT UNSIGNED NOT NULL DEFAULT 0,
            inserted_rows INT UNSIGNED NOT NULL DEFAULT 0,
            updated_rows INT UNSIGNED NOT NULL DEFAULT 0,
            error_message TEXT DEFAULT NULL,
            errors_json MEDIUMTEXT DEFAULT NULL,
            created_by BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME DEFAULT NULL,
            finished_at DATETIME DEFAULT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_registration_import_batches_created_at (created_at),
            KEY idx_registration_import_batches_created_by (created_by),
            KEY idx_registration_import_batches_status (status)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'forced_direction',
          'forced_direction VARCHAR(32) DEFAULT NULL',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'status',
          "status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS' AFTER forced_direction",
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'processed_rows',
          'processed_rows INT UNSIGNED NOT NULL DEFAULT 0 AFTER status',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'error_message',
          'error_message TEXT DEFAULT NULL AFTER updated_rows',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'errors_json',
          'errors_json MEDIUMTEXT DEFAULT NULL AFTER error_message',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'started_at',
          'started_at DATETIME DEFAULT NULL AFTER created_at',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'finished_at',
          'finished_at DATETIME DEFAULT NULL AFTER started_at',
        );
        await addColumnIfMissing(
          conn,
          'registration_import_batches',
          'updated_at',
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER finished_at',
        );

        await addColumnIfMissing(
          conn,
          'users',
          'student_name',
          '`student_name` VARCHAR(120) DEFAULT NULL AFTER `password_hash`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'school_name',
          '`school_name` VARCHAR(255) DEFAULT NULL AFTER `student_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'participation_mode',
          '`participation_mode` VARCHAR(64) DEFAULT NULL AFTER `school_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'mobile',
          '`mobile` VARCHAR(32) DEFAULT NULL AFTER `participation_mode`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'season_name',
          '`season_name` VARCHAR(120) DEFAULT NULL AFTER `mobile`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'region_name',
          '`region_name` VARCHAR(120) DEFAULT NULL AFTER `season_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'event_name',
          '`event_name` VARCHAR(255) DEFAULT NULL AFTER `region_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'group_name',
          '`group_name` VARCHAR(120) DEFAULT NULL AFTER `event_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'grade_name',
          '`grade_name` VARCHAR(64) DEFAULT NULL AFTER `group_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'class_name',
          '`class_name` VARCHAR(120) DEFAULT NULL AFTER `grade_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'delivery_method',
          '`delivery_method` VARCHAR(120) DEFAULT NULL AFTER `class_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'registration_channel',
          '`registration_channel` VARCHAR(120) DEFAULT NULL AFTER `delivery_method`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'team_name',
          '`team_name` VARCHAR(255) DEFAULT NULL AFTER `registration_channel`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'mentor_name',
          '`mentor_name` VARCHAR(120) DEFAULT NULL AFTER `team_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'review_status',
          '`review_status` VARCHAR(120) DEFAULT NULL AFTER `mentor_name`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'external_submitted_at',
          '`external_submitted_at` DATETIME DEFAULT NULL AFTER `review_status`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'external_reviewed_at',
          '`external_reviewed_at` DATETIME DEFAULT NULL AFTER `external_submitted_at`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'last_import_batch_id',
          '`last_import_batch_id` BIGINT UNSIGNED DEFAULT NULL AFTER `external_reviewed_at`',
        );
        await addColumnIfMissing(
          conn,
          'users',
          'last_imported_at',
          '`last_imported_at` DATETIME DEFAULT NULL AFTER `last_import_batch_id`',
        );
      } finally {
        conn.release();
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}

function parseWorkbook(buffer) {
  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel 中没有可读取的工作表');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new Error('Excel 内容为空');
  }

  const headerRow = rows[0].map((item) => normalizeText(item));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerRow.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Excel 表头不完整，缺少：${missingHeaders.join('、')}`);
  }

  const dataRows = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const rawRow = rows[rowIndex];
    const rowObject = {};
    let hasValue = false;

    headerRow.forEach((header, columnIndex) => {
      const value = rawRow[columnIndex];
      rowObject[header] = value;
      if (normalizeText(value)) {
        hasValue = true;
      }
    });

    if (!hasValue) {
      continue;
    }

    dataRows.push({
      rowNumber: rowIndex + 1,
      data: rowObject,
    });
  }

  return {
    sheetName: firstSheetName,
    rows: dataRows,
  };
}

function buildImportPayload(entry, forcedDirection = null) {
  const payload = {};
  Object.entries(IMPORT_FIELD_MAP).forEach(([header, column]) => {
    payload[column] = normalizeNullableText(entry.data[header]);
  });

  payload.external_submitted_at = normalizeDateTime(entry.data['提交时间']);
  payload.external_reviewed_at = normalizeDateTime(entry.data['审核时间']);

  payload.direction = forcedDirection || null;

  return payload;
}

function validateRows(entries, forcedDirection = null) {
  const errors = [];
  const seen = new Map();
  const normalizedRows = [];

  entries.forEach((entry) => {
    const registrationNo = normalizeText(entry.data['报名号']);
    const studentName = normalizeText(entry.data['学生姓名']);
    const mobile = normalizeText(entry.data['手机号']);
    const payload = buildImportPayload(entry, forcedDirection);

    if (!registrationNo) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo: '', message: '报名号不能为空' });
      return;
    }

    if (RESERVED_REGISTRATION_NOS.has(registrationNo)) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo, message: '该报名号为系统保留账号，禁止导入' });
      return;
    }

    if (seen.has(registrationNo)) {
      errors.push({
        rowNumber: entry.rowNumber,
        registrationNo,
        message: `与第 ${seen.get(registrationNo)} 行报名号重复`,
      });
      return;
    }
    seen.set(registrationNo, entry.rowNumber);

    if (!studentName) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo, message: '学生姓名不能为空' });
      return;
    }

    if (!isValidMobile(mobile)) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo, message: '手机号格式不正确' });
      return;
    }

    if (normalizeText(entry.data['提交时间']) && !payload.external_submitted_at) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo, message: '提交时间格式无法识别' });
      return;
    }

    if (normalizeText(entry.data['审核时间']) && !payload.external_reviewed_at) {
      errors.push({ rowNumber: entry.rowNumber, registrationNo, message: '审核时间格式无法识别' });
      return;
    }

    normalizedRows.push({
      rowNumber: entry.rowNumber,
      registrationNo,
      studentName,
      payload,
    });
  });

  return {
    errors,
    rows: normalizedRows,
  };
}

async function getExistingUsersMap(conn, registrationNos) {
  const result = new Map();
  for (const group of chunk(registrationNos, 500)) {
    const placeholders = group.map(() => '?').join(', ');
    const [rows] = await conn.query(
      `SELECT id, registration_no, direction
       FROM users
       WHERE registration_no IN (${placeholders})`,
      group,
    );

    rows.forEach((row) => {
      result.set(row.registration_no, row);
    });
  }
  return result;
}

async function insertImportBatch(conn, payload) {
  const [result] = await conn.query(
    `INSERT INTO registration_import_batches (
      source_file_name,
      source_sheet_name,
      forced_direction,
      status,
      processed_rows,
      total_rows,
      success_rows,
      failed_rows,
      inserted_rows,
      updated_rows,
      error_message,
      errors_json,
      started_at,
      finished_at,
      created_by
    ) VALUES (
      :sourceFileName,
      :sourceSheetName,
      :forcedDirection,
      :status,
      :processedRows,
      :totalRows,
      :successRows,
      :failedRows,
      :insertedRows,
      :updatedRows,
      :errorMessage,
      :errorsJson,
      :startedAt,
      :finishedAt,
      :createdBy
    )`,
    payload,
  );
  return result.insertId;
}

function serializeErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  return JSON.stringify(errors.slice(0, 200));
}

function parseStoredErrors(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function getRunningImportBatch() {
  const rows = await query(
    `SELECT id, source_file_name
     FROM registration_import_batches
     WHERE status = ?
     ORDER BY id DESC
     LIMIT 1`,
    [IMPORT_BATCH_STATUS.RUNNING],
  );
  return rows[0] || null;
}

async function createBatch(payload) {
  const conn = await pool.getConnection();
  try {
    return await insertImportBatch(conn, {
      sourceFileName: payload.sourceFileName,
      sourceSheetName: payload.sourceSheetName || null,
      forcedDirection: payload.forcedDirection || null,
      status: payload.status,
      processedRows: payload.processedRows || 0,
      totalRows: payload.totalRows || 0,
      successRows: payload.successRows || 0,
      failedRows: payload.failedRows || 0,
      insertedRows: payload.insertedRows || 0,
      updatedRows: payload.updatedRows || 0,
      errorMessage: payload.errorMessage || null,
      errorsJson: serializeErrors(payload.errors),
      startedAt: payload.status === IMPORT_BATCH_STATUS.RUNNING ? new Date() : null,
      finishedAt: payload.status === IMPORT_BATCH_STATUS.FAILED ? new Date() : null,
      createdBy: payload.createdBy,
    });
  } finally {
    conn.release();
  }
}

async function updateBatchProgress(conn, batchId, payload) {
  await conn.query(
    `UPDATE registration_import_batches
     SET processed_rows = :processedRows,
         success_rows = :successRows,
         failed_rows = :failedRows,
         inserted_rows = :insertedRows,
         updated_rows = :updatedRows
     WHERE id = :batchId`,
    {
      batchId,
      processedRows: payload.processedRows,
      successRows: payload.successRows,
      failedRows: payload.failedRows,
      insertedRows: payload.insertedRows,
      updatedRows: payload.updatedRows,
    },
  );
}

async function markBatchCompleted(conn, batchId, payload) {
  await conn.query(
    `UPDATE registration_import_batches
     SET status = :status,
         processed_rows = :processedRows,
         success_rows = :successRows,
         failed_rows = 0,
         inserted_rows = :insertedRows,
         updated_rows = :updatedRows,
         error_message = NULL,
         errors_json = NULL,
         finished_at = NOW()
     WHERE id = :batchId`,
    {
      batchId,
      status: IMPORT_BATCH_STATUS.SUCCESS,
      processedRows: payload.processedRows,
      successRows: payload.successRows,
      insertedRows: payload.insertedRows,
      updatedRows: payload.updatedRows,
    },
  );
}

async function markBatchFailed(batchId, error, payload = {}) {
  await query(
    `UPDATE registration_import_batches
     SET status = :status,
         processed_rows = :processedRows,
         success_rows = :successRows,
         failed_rows = :failedRows,
         inserted_rows = :insertedRows,
         updated_rows = :updatedRows,
         error_message = :errorMessage,
         errors_json = :errorsJson,
         finished_at = NOW()
     WHERE id = :batchId`,
    {
      batchId,
      status: IMPORT_BATCH_STATUS.FAILED,
      processedRows: payload.processedRows || 0,
      successRows: payload.successRows || 0,
      failedRows: payload.failedRows || 0,
      insertedRows: payload.insertedRows || 0,
      updatedRows: payload.updatedRows || 0,
      errorMessage: error.message || String(error),
      errorsJson: serializeErrors(payload.errors),
    },
  );
}

async function runImportBatch(batchId, rows) {
  const conn = await pool.getConnection();
  const counters = {
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    insertedRows: 0,
    updatedRows: 0,
  };

  try {
    const existingUsers = await getExistingUsersMap(
      conn,
      rows.map((row) => row.registrationNo),
    );

    for (const row of rows) {
      const existing = existingUsers.get(row.registrationNo);
      const userPayload = {
        ...row.payload,
        last_import_batch_id: batchId,
        last_imported_at: new Date(),
      };

      if (existing) {
        const directionToWrite = existing.direction || row.payload.direction;
        await conn.query(
          `UPDATE users
           SET student_name = :student_name,
               school_name = :school_name,
               participation_mode = :participation_mode,
               mobile = :mobile,
               season_name = :season_name,
               region_name = :region_name,
               event_name = :event_name,
               group_name = :group_name,
               grade_name = :grade_name,
               class_name = :class_name,
               delivery_method = :delivery_method,
               registration_channel = :registration_channel,
               team_name = :team_name,
               mentor_name = :mentor_name,
               review_status = :review_status,
               external_submitted_at = :external_submitted_at,
               external_reviewed_at = :external_reviewed_at,
               direction = :direction,
               last_import_batch_id = :last_import_batch_id,
               last_imported_at = :last_imported_at
           WHERE id = :id`,
          {
            ...userPayload,
            direction: directionToWrite || null,
            id: existing.id,
          },
        );
        counters.updatedRows += 1;
      } else {
        const passwordHash = await hashPassword(initialPassword(row.registrationNo));
        await conn.query(
          `INSERT INTO users (
            registration_no,
            password_hash,
            direction,
            ${USER_IMPORT_COLUMNS.join(', ')}
          ) VALUES (
            :registration_no,
            :password_hash,
            :direction,
            ${USER_IMPORT_COLUMNS.map((column) => `:${column}`).join(', ')}
          )`,
          {
            registration_no: row.registrationNo,
            password_hash: passwordHash,
            direction: row.payload.direction || null,
            ...userPayload,
          },
        );
        counters.insertedRows += 1;
      }

      counters.processedRows += 1;
      counters.successRows += 1;

      if (counters.processedRows % PROGRESS_UPDATE_INTERVAL === 0) {
        await updateBatchProgress(conn, batchId, counters);
      }
    }

    await markBatchCompleted(conn, batchId, counters);
  } catch (error) {
    await markBatchFailed(batchId, error, counters);
    console.error('Registration import job failed:', error);
  } finally {
    conn.release();
  }
}

function scheduleImportBatch(batchId, rows) {
  setImmediate(() => {
    runImportBatch(batchId, rows).catch((error) => {
      console.error('Registration import job crashed:', error);
    });
  });
}

async function startImportJob({ buffer, originalName, createdBy, forcedDirection = null }) {
  await ensureSchema();

  const runningBatch = await getRunningImportBatch();
  if (runningBatch) {
    throw new Error(`已有导入任务正在执行：#${runningBatch.id} ${runningBatch.source_file_name}`);
  }

  const sourceFileName = normalizeSourceFileName(originalName);
  let workbook;
  let validation;

  try {
    workbook = parseWorkbook(buffer);
    validation = validateRows(workbook.rows, forcedDirection);
  } catch (error) {
    const batchId = await createBatch({
      sourceFileName,
      status: IMPORT_BATCH_STATUS.FAILED,
      failedRows: 1,
      errorMessage: error.message,
      createdBy,
    });
    return getImportBatch(batchId);
  }

  if (validation.rows.length === 0) {
    const errors = validation.errors.length > 0
      ? validation.errors
      : [{ rowNumber: '-', registrationNo: '-', message: '没有可导入的数据行' }];
    const batchId = await createBatch({
      sourceFileName,
      sourceSheetName: workbook.sheetName,
      forcedDirection,
      status: IMPORT_BATCH_STATUS.FAILED,
      totalRows: workbook.rows.length,
      failedRows: errors.length || workbook.rows.length,
      errorMessage: '没有可导入的数据行',
      errors,
      createdBy,
    });
    return getImportBatch(batchId);
  }

  if (validation.errors.length > 0) {
    const batchId = await createBatch({
      sourceFileName,
      sourceSheetName: workbook.sheetName,
      forcedDirection,
      status: IMPORT_BATCH_STATUS.FAILED,
      totalRows: workbook.rows.length,
      failedRows: validation.errors.length,
      errorMessage: 'Excel 数据校验失败',
      errors: validation.errors,
      createdBy,
    });
    return getImportBatch(batchId);
  }

  const batchId = await createBatch({
    sourceFileName,
    sourceSheetName: workbook.sheetName,
    forcedDirection,
    status: IMPORT_BATCH_STATUS.RUNNING,
    totalRows: workbook.rows.length,
    createdBy,
  });

  scheduleImportBatch(batchId, validation.rows);
  return getImportBatch(batchId);
}

async function getImportBatch(batchId) {
  await ensureSchema();

  const rows = await query(
    `SELECT
      rib.*,
      u.registration_no AS creator_registration_no
    FROM registration_import_batches rib
    LEFT JOIN users u ON u.id = rib.created_by
    WHERE rib.id = ?
    LIMIT 1`,
    [batchId],
  );

  if (!rows[0]) {
    return null;
  }

  return mapImportBatch(rows[0]);
}

async function importWorkbook(options) {
  return startImportJob(options);
}

async function listRecentBatches(limit = 10) {
  await ensureSchema();

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const rows = await query(
    `SELECT
      rib.*,
      u.registration_no AS creator_registration_no
    FROM registration_import_batches rib
    LEFT JOIN users u ON u.id = rib.created_by
    ORDER BY rib.id DESC
    LIMIT ${safeLimit}`,
  );

  return rows.map(mapImportBatch);
}

function mapImportBatch(row) {
  const totalRows = Number(row.total_rows) || 0;
  const processedRows = Number(row.processed_rows) || 0;
  return {
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceSheetName: row.source_sheet_name,
    forcedDirection: row.forced_direction,
    status: row.status || IMPORT_BATCH_STATUS.SUCCESS,
    processedRows,
    progressPercent: totalRows > 0 ? Math.min(100, Math.round((processedRows / totalRows) * 100)) : 0,
    totalRows,
    successRows: Number(row.success_rows) || 0,
    failedRows: Number(row.failed_rows) || 0,
    insertedRows: Number(row.inserted_rows) || 0,
    updatedRows: Number(row.updated_rows) || 0,
    errorMessage: row.error_message || '',
    errors: parseStoredErrors(row.errors_json),
    createdBy: row.creator_registration_no || row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

async function getPageData() {
  const recentBatches = await listRecentBatches(12);
  return {
    requiredHeaders: REQUIRED_HEADERS,
    recentBatches,
    tracks: [TRACKS.KNOWLEDGE, TRACKS.INNOVATION],
    trackLabels: TRACK_LABELS,
  };
}

module.exports = {
  ensureSchema,
  getImportBatch,
  getPageData,
  importWorkbook,
  listRecentBatches,
  startImportJob,
};
