const mysql = require('mysql2/promise');
const config = require('../src/config');

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

  await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
}

async function main() {
  try {
    const bootstrapConn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      charset: 'utf8mb4',
    });

    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await bootstrapConn.end();
  } catch (error) {
    if (!['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(error.code)) {
      throw error;
    }
    console.warn(`跳过 CREATE DATABASE：${error.message}`);
  }

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      registration_no VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      direction ENUM('KNOWLEDGE', 'INNOVATION') DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL UNIQUE,
      work_title VARCHAR(255) DEFAULT NULL,
      status ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',

      report_file_path VARCHAR(500) DEFAULT NULL,
      report_original_name VARCHAR(255) DEFAULT NULL,
      report_stored_name VARCHAR(255) DEFAULT NULL,
      report_uploaded_at DATETIME DEFAULT NULL,

      proof1_file_path VARCHAR(500) DEFAULT NULL,
      proof1_original_name VARCHAR(255) DEFAULT NULL,
      proof1_stored_name VARCHAR(255) DEFAULT NULL,
      proof1_uploaded_at DATETIME DEFAULT NULL,

      proof2_file_path VARCHAR(500) DEFAULT NULL,
      proof2_original_name VARCHAR(255) DEFAULT NULL,
      proof2_stored_name VARCHAR(255) DEFAULT NULL,
      proof2_uploaded_at DATETIME DEFAULT NULL,

      integrity_file_path VARCHAR(500) DEFAULT NULL,
      integrity_original_name VARCHAR(255) DEFAULT NULL,
      integrity_stored_name VARCHAR(255) DEFAULT NULL,
      integrity_uploaded_at DATETIME DEFAULT NULL,

      submitted_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      CONSTRAINT fk_submissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await addColumnIfMissing(
    conn,
    'submissions',
    'report_file_size',
    '`report_file_size` BIGINT UNSIGNED DEFAULT NULL AFTER `report_stored_name`',
  );
  await addColumnIfMissing(
    conn,
    'submissions',
    'proof1_file_size',
    '`proof1_file_size` BIGINT UNSIGNED DEFAULT NULL AFTER `proof1_stored_name`',
  );
  await addColumnIfMissing(
    conn,
    'submissions',
    'proof2_file_size',
    '`proof2_file_size` BIGINT UNSIGNED DEFAULT NULL AFTER `proof2_stored_name`',
  );
  await addColumnIfMissing(
    conn,
    'submissions',
    'integrity_file_size',
    '`integrity_file_size` BIGINT UNSIGNED DEFAULT NULL AFTER `integrity_stored_name`',
  );

  await conn.query(`
    CREATE TABLE IF NOT EXISTS export_batch_configs (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      batch_size INT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS export_batches (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      batch_no INT UNSIGNED NOT NULL UNIQUE,
      item_count INT UNSIGNED NOT NULL,
      start_registration_no VARCHAR(64) DEFAULT NULL,
      end_registration_no VARCHAR(64) DEFAULT NULL,
      status ENUM('PACKAGING', 'READY', 'DOWNLOADED', 'FAILED') NOT NULL DEFAULT 'PACKAGING',
      archive_path VARCHAR(500) DEFAULT NULL,
      manifest_path VARCHAR(500) DEFAULT NULL,
      error_message VARCHAR(500) DEFAULT NULL,
      packaged_at DATETIME DEFAULT NULL,
      downloaded_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_export_batches_status_batch_no (status, batch_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS export_batch_items (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      batch_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL UNIQUE,
      seq_no INT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_export_batch_items_batch_seq (batch_id, seq_no),
      CONSTRAINT fk_export_batch_items_batch FOREIGN KEY (batch_id) REFERENCES export_batches(id) ON DELETE CASCADE,
      CONSTRAINT fk_export_batch_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await conn.end();

  console.log(`数据库初始化完成：${config.db.database}`);
}

main().catch((error) => {
  console.error('数据库初始化失败：', error.message);
  process.exit(1);
});
