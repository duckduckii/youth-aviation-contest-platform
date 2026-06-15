const { pool } = require('../src/db');

async function clearDatabase() {
  console.log('开始清空数据库...');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 获取当前数据计数
    const [userCount] = await conn.query('SELECT COUNT(*) as count FROM users');
    const [batchCount] = await conn.query('SELECT COUNT(*) as count FROM registration_import_batches');

    console.log(`当前用户数: ${userCount[0].count}`);
    console.log(`当前导入批次: ${batchCount[0].count}`);

    // 清空表
    await conn.query('DELETE FROM submissions');
    console.log('已清空 submissions 表');

    await conn.query('DELETE FROM export_batches');
    console.log('已清空 export_batches 表');

    await conn.query('DELETE FROM registration_import_batches');
    console.log('已清空 registration_import_batches 表');

    await conn.query('DELETE FROM users WHERE registration_no != "admin" AND registration_no != "test"');
    console.log('已清空 users 表（保留 admin 和 test 账号）');

    await conn.commit();
    console.log('清空完成！');

  } catch (error) {
    await conn.rollback();
    console.error('清空失败:', error);
    throw error;
  } finally {
    conn.release();
  }
}

clearDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
