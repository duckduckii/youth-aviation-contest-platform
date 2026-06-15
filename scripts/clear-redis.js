const redis = require('redis');
const config = require('../src/config');

async function clearRedis() {
  console.log('开始清空 Redis Session...');

  const client = redis.createClient({
    url: config.redis.url || `redis://${config.redis.host}:${config.redis.port}`,
    password: config.redis.password || undefined,
    database: config.redis.db || 0,
  });

  await client.connect();

  try {
    const keys = await client.keys(`${config.redis.prefix}*`);
    console.log(`找到 ${keys.length} 个 session keys`);

    if (keys.length > 0) {
      await client.del(keys);
      console.log('已删除所有 session');
    }

    console.log('Redis 清理完成！');

  } catch (error) {
    console.error('清理 Redis 失败:', error);
    throw error;
  } finally {
    await client.quit();
  }
}

clearRedis()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
