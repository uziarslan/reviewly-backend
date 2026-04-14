const Redis = require("ioredis");

let redisClient = null;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
    });

    redisClient.on("error", (err) => {
      console.error("Redis connection error:", err.message);
    });

    redisClient.on("connect", () => {
      console.log("✅ Redis connected");
    });
  } catch (err) {
    console.error("Failed to create Redis client:", err.message);
    redisClient = null;
  }
}

function getRedis() {
  return redisClient;
}

module.exports = { getRedis };
