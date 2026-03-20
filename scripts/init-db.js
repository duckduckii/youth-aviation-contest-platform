const mysql = require('mysql2/promise');
const config = require('../src/config');

async function main() {
  const bootstrapConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
  });

  await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrapConn.end();

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

  await conn.end();

  console.log(`数据库初始化完成：${config.db.database}`);
}

main().catch((error) => {
  console.error('数据库初始化失败：', error.message);
  process.exit(1);
});
