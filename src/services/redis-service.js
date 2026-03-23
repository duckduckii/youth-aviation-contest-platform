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

module.exports = {
  createRedisClient,
  ensureRedisConnected,
};
