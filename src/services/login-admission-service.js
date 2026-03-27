const config = require('../config');

async function acquireLoginSlot(redisClient) {
  if (!config.login.admissionEnabled || !redisClient?.isOpen) {
    return { ok: true, count: 0 };
  }

  const key = config.login.counterKey;
  const count = await redisClient.incr(key);
  await redisClient.expire(key, config.login.slotTtlSeconds);

  if (count > config.login.maxInflight) {
    const nextValue = await redisClient.decr(key);
    if (nextValue <= 0) {
      await redisClient.del(key);
    }
    return { ok: false, count };
  }

  return { ok: true, count };
}

async function releaseLoginSlot(redisClient) {
  if (!config.login.admissionEnabled || !redisClient?.isOpen) {
    return;
  }

  const key = config.login.counterKey;
  const nextValue = await redisClient.decr(key);
  if (nextValue <= 0) {
    await redisClient.del(key);
  }
}

module.exports = {
  acquireLoginSlot,
  releaseLoginSlot,
};
