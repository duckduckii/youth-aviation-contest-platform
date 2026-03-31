const { createClient } = require('redis');
const config = require('../config');

function createRedisClient() {
  const options = config.redis.url
    ? { url: config.redis.url }
    : {
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
        password: config.redis.password || undefined,
        database: config.redis.db,
      };

  const client = createClient(options);
  client.on('error', (error) => {
    console.error('Redis 连接错误：', error.message);
  });
  return client;
}

async function ensureRedisConnected(client) {
  if (client.isOpen) {
    return client;
  }

  await client.connect();
  return client;
}

function buildLockToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function releaseLock(client, key, token) {
  if (!client?.isOpen || !key || !token) {
    return;
  }

  const currentValue = await client.get(key);
  if (currentValue === token) {
    await client.del(key);
  }
}

async function withRedisLock(client, key, ttlSeconds, handler) {
  if (!client?.isOpen) {
    return handler();
  }

  const token = buildLockToken();
  const result = await client.set(key, token, {
    NX: true,
    EX: Math.max(1, Number(ttlSeconds) || 1),
  });

  if (result !== 'OK') {
    const error = new Error('任务已在处理中');
    error.code = 'REDIS_LOCKED';
    throw error;
  }

  try {
    return await handler();
  } finally {
    await releaseLock(client, key, token);
  }
}

module.exports = {
  createRedisClient,
  ensureRedisConnected,
  withRedisLock,
};
