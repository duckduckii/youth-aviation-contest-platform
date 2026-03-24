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
