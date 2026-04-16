const Redis = require("ioredis");

let redisClient = null;
let redisErrorLogged = false;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL || "redis://127.0.0.1:6379";
const shouldUseTls = Boolean(process.env.REDIS_TLS_URL) || /^rediss:\/\//i.test(redisUrl || "");

function buildRedisOptions() {
  const redisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    reconnectOnError(err) {
      if (!err || !err.message) return false;
      return /READONLY|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/.test(err.message);
    },
    retryStrategy(times) {
      if (times >= 5) return null;
      return Math.min(1000 * 2 ** (times - 1), 5000);
    },
  };

  if (shouldUseTls) {
    redisOptions.tls = { rejectUnauthorized: false };
  }

  return redisOptions;
}

try {
  const redisOptions = buildRedisOptions();
  redisClient = new Redis(redisUrl, redisOptions);

  redisClient.once("connect", () => {
    console.log("✅ Redis connected");
    redisErrorLogged = false;
  });

  redisClient.on("error", (err) => {
    if (!redisErrorLogged) {
      console.error("Redis connection error:", err.message);
      redisErrorLogged = true;
    }
  });

  redisClient.on("end", () => {
    if (!redisErrorLogged) {
      console.warn("Redis connection ended");
      redisErrorLogged = true;
    }
  });
} catch (err) {
  console.error("Failed to create Redis client:", err.message);
  redisClient = null;
}

function getRedis() {
  return redisClient && redisClient.status === "ready" ? redisClient : null;
}

function getRedisClient() {
  return redisClient;
}

function createRedisConnection() {
  const redisOptions = buildRedisOptions();
  return new Redis(redisUrl, redisOptions);
}

module.exports = { getRedis, getRedisClient, createRedisConnection };
