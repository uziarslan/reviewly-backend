const Redis = require("ioredis");

let redisClient = null;
let redisErrorLogged = false;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL;
const shouldUseTls = Boolean(process.env.REDIS_TLS_URL) || /^rediss?:\/\//i.test(redisUrl || "");

if (redisUrl) {
  try {
    const redisOptions = {
      maxRetriesPerRequest: 3,
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
}

function getRedis() {
  if (!redisClient || redisClient.status !== "ready") {
    return null;
  }
  return redisClient;
}

module.exports = { getRedis };
