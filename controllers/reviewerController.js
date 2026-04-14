const Reviewer = require("../models/Reviewer");
const { getRedis } = require("../config/redis");

const CACHE_TTL = 300; // 5 minutes
const KEY_ALL = "reviewers:all";

async function invalidateReviewerCache(redisClient, id) {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(`${KEY_ALL}*`);
    if (keys.length) await redisClient.del(...keys);
    if (id) {
      await redisClient.del(`reviewers:id:${id}`);
    }
  } catch (err) {
    console.error("Redis cache invalidation error:", err.message);
  }
}

exports.invalidateReviewerCache = invalidateReviewerCache;

/**
 * GET /api/reviewers
 * Returns published reviewers (paginated).
 */
exports.getAllReviewers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const filter = { status: "published" };

    const redis = getRedis();
    const cacheKey = `${KEY_ALL}:${page}:${limit}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          return res.json(parsed);
        }
      } catch (_) {
        /* fall through to MongoDB */
      }
    }

    const [reviewers, total] = await Promise.all([
      Reviewer.find(filter).sort({ order: 1 }).skip((page - 1) * limit).limit(limit),
      Reviewer.countDocuments(filter),
    ]);

    const payload = {
      success: true,
      data: reviewers,
      count: reviewers.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    };

    if (redis) {
      try {
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(payload));
      } catch (_) {
        /* ignore */
      }
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/reviewers/:id
 * Returns a single reviewer by _id.
 */
exports.getReviewerById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const redis = getRedis();
    const keyId = `reviewers:id:${id}`;

    if (redis) {
      try {
        const cached = await redis.get(keyId);
        if (cached) {
          const parsed = JSON.parse(cached);
          return res.json(parsed);
        }
      } catch (_) {
        /* fall through to MongoDB */
      }
    }

    const reviewer = await Reviewer.findById(id);
    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Reviewer not found" });
    }

    const payload = { success: true, data: reviewer };
    if (redis) {
      try {
        await redis.setex(keyId, CACHE_TTL, JSON.stringify(payload));
      } catch (_) {
        /* ignore */
      }
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/reviewers/slug/:slug
 * Returns a reviewer by slug.
 */
exports.getReviewerBySlug = async (req, res, next) => {
  try {
    const reviewer = await Reviewer.findOne({ slug: req.params.slug });
    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Reviewer not found" });
    }
    res.json({ success: true, data: reviewer });
  } catch (err) {
    next(err);
  }
};
