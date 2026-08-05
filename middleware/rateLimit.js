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
      "Failed to initialize RedisStore for rate limiting:",
      err.message
    );
    store = undefined;
  }
} else {
  console.warn(
    "Rate limiting using in-memory store; Redis is unavailable or not ready."
  );
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
  max: 50,
  store,
  // Session verification has its own authenticated-user limiter below. It
  // must not be blocked because many users appear behind one proxy address.
  skip: (req) => req.method === "GET" && req.path === "/me",
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
  skip: (req) => {
    if (req.method === "GET" && (req.path === "/health" || req.path === "/auth/me")) return true;
    return req.method === "POST" && /^\/(exams|trial-assessment)\/attempts\/[^/]+\/submit$/.test(req.path);
  },
  ...baseOptions,
});

// These run after authentication and key by user, preventing a shared office,
// school, carrier NAT, or misreported proxy IP from blocking critical requests.
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  ...baseOptions,
});

const examSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  ...baseOptions,
});

module.exports = {
  authLimiter,
  supportLimiter,
  apiLimiter,
  sessionLimiter,
  examSubmitLimiter,
};

