const xlsx = require('xlsx');

const config = require('../config');
const { pool, query } = require('../db');
const { TRACKS } = require('../constants');
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

function inferDirection(eventName) {
  const text = normalizeText(eventName);
  if (!text) return null;
  if (text.includes('知识')) return TRACKS.KNOWLEDGE;
  if (text.includes('创新设计') || text.includes('航模')) return TRACKS.INNOVATION;
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
            total_rows INT UNSIGNED NOT NULL DEFAULT 0,
            success_rows INT UNSIGNED NOT NULL DEFAULT 0,
            failed_rows INT UNSIGNED NOT NULL DEFAULT 0,
            inserted_rows INT UNSIGNED NOT NULL DEFAULT 0,
            updated_rows INT UNSIGNED NOT NULL DEFAULT 0,
            created_by BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_registration_import_batches_created_at (created_at),
            KEY idx_registration_import_batches_created_by (created_by)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

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

function buildImportPayload(entry) {
  const payload = {};
  Object.entries(IMPORT_FIELD_MAP).forEach(([header, column]) => {
    payload[column] = normalizeNullableText(entry.data[header]);
  });

  payload.external_submitted_at = normalizeDateTime(entry.data['提交时间']);
  payload.external_reviewed_at = normalizeDateTime(entry.data['审核时间']);
  payload.direction = inferDirection(entry.data['赛事类型']);

  return payload;
}

function validateRows(entries) {
  const errors = [];
  const seen = new Map();
  const normalizedRows = [];

  entries.forEach((entry) => {
    const registrationNo = normalizeText(entry.data['报名号']);
    const studentName = normalizeText(entry.data['学生姓名']);
    const mobile = normalizeText(entry.data['手机号']);
    const payload = buildImportPayload(entry);

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

    if (mobile && !/^\d{6,20}$/.test(mobile)) {
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
      total_rows,
      success_rows,
      failed_rows,
      inserted_rows,
      updated_rows,
      created_by
    ) VALUES (
      :sourceFileName,
      :sourceSheetName,
      :totalRows,
      :successRows,
      :failedRows,
      :insertedRows,
      :updatedRows,
      :createdBy
    )`,
    payload,
  );
  return result.insertId;
}

async function importWorkbook({ buffer, originalName, createdBy }) {
  await ensureSchema();

  const workbook = parseWorkbook(buffer);
  const validation = validateRows(workbook.rows);
  const totalRows = workbook.rows.length;
  const sourceFileName = normalizeSourceFileName(originalName);

  if (validation.rows.length === 0) {
    return {
      ok: false,
      totalRows,
      successRows: 0,
      failedRows: validation.errors.length || totalRows,
      insertedRows: 0,
      updatedRows: 0,
      errors: validation.errors.length > 0
        ? validation.errors
        : [{ rowNumber: '-', registrationNo: '-', message: '没有可导入的数据行' }],
      sourceFileName,
      sourceSheetName: workbook.sheetName,
    };
  }

  if (validation.errors.length > 0) {
    return {
      ok: false,
      totalRows,
      successRows: 0,
      failedRows: validation.errors.length,
      insertedRows: 0,
      updatedRows: 0,
      errors: validation.errors,
      sourceFileName,
      sourceSheetName: workbook.sheetName,
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const existingUsers = await getExistingUsersMap(
      conn,
      validation.rows.map((row) => row.registrationNo),
    );

    let insertedRows = 0;
    let updatedRows = 0;

    const batchId = await insertImportBatch(conn, {
      sourceFileName,
      sourceSheetName: workbook.sheetName,
      totalRows,
      successRows: validation.rows.length,
      failedRows: 0,
      insertedRows: 0,
      updatedRows: 0,
      createdBy,
    });

    for (const row of validation.rows) {
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
        updatedRows += 1;
        continue;
      }

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
      insertedRows += 1;
    }

    await conn.query(
      `UPDATE registration_import_batches
       SET success_rows = :successRows,
           failed_rows = 0,
           inserted_rows = :insertedRows,
           updated_rows = :updatedRows
       WHERE id = :batchId`,
      {
        batchId,
        successRows: validation.rows.length,
        insertedRows,
        updatedRows,
      },
    );

    await conn.commit();

    return {
      ok: true,
      totalRows,
      successRows: validation.rows.length,
      failedRows: 0,
      insertedRows,
      updatedRows,
      batchId,
      errors: [],
      sourceFileName,
      sourceSheetName: workbook.sheetName,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
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

  return rows.map((row) => ({
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceSheetName: row.source_sheet_name,
    totalRows: Number(row.total_rows) || 0,
    successRows: Number(row.success_rows) || 0,
    failedRows: Number(row.failed_rows) || 0,
    insertedRows: Number(row.inserted_rows) || 0,
    updatedRows: Number(row.updated_rows) || 0,
    createdBy: row.creator_registration_no || row.created_by,
    createdAt: row.created_at,
  }));
}

async function getPageData() {
  const recentBatches = await listRecentBatches(12);
  return {
    requiredHeaders: REQUIRED_HEADERS,
    recentBatches,
  };
}

module.exports = {
  ensureSchema,
  getPageData,
  importWorkbook,
};
