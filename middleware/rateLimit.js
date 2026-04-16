const { rateLimit } = require("express-rate-limit");
const rateLimitRedis = require("rate-limit-redis");
const { getRedis } = require("../config/redis");

const RedisStore = rateLimitRedis.RedisStore || rateLimitRedis.default || rateLimitRedis;

const redisClient = getRedis();

let store = undefined;

if (redisClient) {
  try {
    store = new RedisStore({
      sendCommand: (command, ...args) =>
        redisClient.call(command, ...args),
    });
  } catch (err) {
    console.error(
      "Failed to initialize RedisStore for rate limiting, falling back to in-memory store:",
      err.message
    );
    store = undefined;
  }
} else {
  console.warn("Rate limiting using in-memory store; set REDIS_URL/REDIS_TLS_URL for shared limits");
}

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please slow down.",
  },
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store,
  ...baseOptions,
});

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store,
  ...baseOptions,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  store,
  skip: (req) => req.method === "GET" && req.path === "/health",
  ...baseOptions,
});

module.exports = {
  authLimiter,
  supportLimiter,
  apiLimiter,
};

