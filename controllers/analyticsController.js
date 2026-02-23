const User = require("../models/User");
const Attempt = require("../models/Attempt");
const Reviewer = require("../models/Reviewer");
const { hogqlQuery } = require("../services/posthog");

const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

function posthogConfigured() {
  return !!(POSTHOG_PERSONAL_API_KEY && POSTHOG_PROJECT_ID);
}

// ── Helper: date range from query params ────────
function getDateRange(req) {
  const days = parseInt(req.query.days) || 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end, days };
}

/**
 * GET /api/admin/analytics/overview
 * Returns high-level stats: total users, total exams, completion rate, avg duration, etc.
 */
exports.getOverview = async (req, res, next) => {
  try {
    if (!posthogConfigured()) {
      return res.json({
        success: true,
        data: {},
        message:
          "Admin analytics are not configured on this server. Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to enable analytics.",
      });
    }
    const { start } = getDateRange(req);

    const [
      totalUsers,
      newUsersInRange,
      totalAttempts,
      completedAttempts,
      avgDurationResult,
      planDistribution,
    ] = await Promise.all([
      // Total non-admin users
      User.countDocuments({ isAdmin: { $ne: true } }),
      // New users in date range
      User.countDocuments({ isAdmin: { $ne: true }, createdAt: { $gte: start } }),
      // Total exam attempts in range
      Attempt.countDocuments({ createdAt: { $gte: start } }),
      // Completed exam attempts in range
      Attempt.countDocuments({
        status: { $in: ["submitted", "timed_out"] },
        createdAt: { $gte: start },
      }),
      // Average exam duration (ms between startedAt and submittedAt) for completed exams
      Attempt.aggregate([
        {
          $match: {
            status: { $in: ["submitted", "timed_out"] },
            submittedAt: { $ne: null },
            startedAt: { $ne: null },
            createdAt: { $gte: start },
          },
        },
        {
          $project: {
            durationMs: { $subtract: ["$submittedAt", "$startedAt"] },
          },
        },
        {
          $group: {
            _id: null,
            avgDuration: { $avg: "$durationMs" },
            minDuration: { $min: "$durationMs" },
            maxDuration: { $max: "$durationMs" },
          },
        },
      ]),
      // Subscription plan distribution
      User.aggregate([
        { $match: { isAdmin: { $ne: true } } },
        {
          $group: {
            _id: "$subscription.plan",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    const completionRate =
      totalAttempts > 0
        ? Math.round((completedAttempts / totalAttempts) * 100 * 10) / 10
        : 0;

    const avgDuration = avgDurationResult[0]
      ? Math.round(avgDurationResult[0].avgDuration / 1000) // in seconds
      : 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersInRange,
        totalAttempts,
        completedAttempts,
        completionRate,
        avgDurationSeconds: avgDuration,
        planDistribution: planDistribution.map((p) => ({
          plan: p._id || "free",
          count: p.count,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/analytics/exams
 * Exam-level analytics: per-exam attempts, completions, avg score, avg duration.
 */
exports.getExamAnalytics = async (req, res, next) => {
  try {
    if (!posthogConfigured()) {
      return res.json({ success: true, data: [], message: 'Admin analytics not configured.' });
    }
    const { start } = getDateRange(req);

    const examStats = await Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: "$reviewer",
          totalAttempts: { $sum: 1 },
          completedAttempts: {
            $sum: {
              $cond: [
                { $in: ["$status", ["submitted", "timed_out"]] },
                1,
                0,
              ],
            },
          },
          avgScore: {
            $avg: {
              $cond: [
                { $in: ["$status", ["submitted", "timed_out"]] },
                "$result.percentage",
                null,
              ],
            },
          },
          avgDuration: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $in: ["$status", ["submitted", "timed_out"]] },
                    { $ne: ["$submittedAt", null] },
                  ],
                },
                { $subtract: ["$submittedAt", "$startedAt"] },
                null,
              ],
            },
          },
          passCount: {
            $sum: {
              $cond: [{ $eq: ["$result.passed", true] }, 1, 0],
            },
          },
        },
      },
      { $sort: { totalAttempts: -1 } },
    ]);

    // Populate reviewer names
    const reviewerIds = examStats.map((s) => s._id);
    const reviewers = await Reviewer.find({ _id: { $in: reviewerIds } })
      .select("title slug")
      .lean();
    const reviewerMap = {};
    reviewers.forEach((r) => {
      reviewerMap[String(r._id)] = r;
    });

    const data = examStats.map((s) => {
      const rev = reviewerMap[String(s._id)] || {};
      return {
        reviewerId: s._id,
        reviewerName: rev.title || "Unknown",
        reviewerSlug: rev.slug || "",
        totalAttempts: s.totalAttempts,
        completedAttempts: s.completedAttempts,
        completionRate:
          s.totalAttempts > 0
            ? Math.round((s.completedAttempts / s.totalAttempts) * 100 * 10) /
              10
            : 0,
        avgScore: s.avgScore ? Math.round(s.avgScore * 10) / 10 : 0,
        avgDurationSeconds: s.avgDuration
          ? Math.round(s.avgDuration / 1000)
          : 0,
        passCount: s.passCount,
        passRate:
          s.completedAttempts > 0
            ? Math.round(
                (s.passCount / s.completedAttempts) * 100 * 10
              ) / 10
            : 0,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/analytics/users
 * User engagement analytics: signups over time, active users, login frequency.
 */
exports.getUserAnalytics = async (req, res, next) => {
  try {
    if (!posthogConfigured()) {
      return res.json({ success: true, data: {}, message: 'Admin analytics not configured.' });
    }
    const { start, days } = getDateRange(req);

    // Signups over time (grouped by day)
    const signupsByDay = await User.aggregate([
      {
        $match: {
          isAdmin: { $ne: true },
          createdAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Active users (users with at least one exam attempt in range)
    const activeUsers = await Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: "$user" } },
      { $count: "count" },
    ]);

    // Exam activity by day (attempts started per day)
    const activityByDay = await Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          attempts: { $sum: 1 },
          uniqueUsers: { $addToSet: "$user" },
        },
      },
      {
        $project: {
          _id: 1,
          attempts: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Exam activity by hour (across all days in range)
    const activityByHour = await Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          attempts: { $sum: 1 },
          uniqueUsers: { $addToSet: "$user" },
        },
      },
      {
        $project: {
          _id: 1,
          attempts: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        signupsByDay,
        activeUsersCount: activeUsers[0]?.count || 0,
        activityByDay,
        activityByHour,
        days,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/analytics/retention
 * Retention metrics: returning users, avg exams per user, top users.
 */
exports.getRetentionAnalytics = async (req, res, next) => {
  try {
    if (!posthogConfigured()) {
      // Return basic MongoDB-derived retention data as empty to avoid errors when PostHog keys are missing
      return res.json({
        success: true,
        data: {
          totalActiveUsers: 0,
          returningUsers: 0,
          returningRate: 0,
          avgAttemptsPerUser: 0,
          topUsers: [],
          loginFrequency: null,
        },
        message: 'Admin analytics not configured.',
      });
    }
    const { start } = getDateRange(req);

    // Users with multiple attempts (returning users)
    const userAttemptCounts = await Attempt.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: "$user",
          attemptCount: { $sum: 1 },
          completedCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["submitted", "timed_out"]] },
                1,
                0,
              ],
            },
          },
          lastAttempt: { $max: "$createdAt" },
        },
      },
      { $sort: { attemptCount: -1 } },
    ]);

    const totalActiveUsers = userAttemptCounts.length;
    const returningUsers = userAttemptCounts.filter(
      (u) => u.attemptCount > 1
    ).length;
    const avgAttemptsPerUser =
      totalActiveUsers > 0
        ? Math.round(
            (userAttemptCounts.reduce((sum, u) => sum + u.attemptCount, 0) /
              totalActiveUsers) *
              10
          ) / 10
        : 0;

    // Top 10 most active users
    const topUserIds = userAttemptCounts.slice(0, 10).map((u) => u._id);
    const topUsersInfo = await User.find({ _id: { $in: topUserIds } })
      .select("firstName lastName email")
      .lean();
    const userMap = {};
    topUsersInfo.forEach((u) => {
      userMap[String(u._id)] = u;
    });

    const topUsers = userAttemptCounts.slice(0, 10).map((u) => {
      const info = userMap[String(u._id)] || {};
      return {
        userId: u._id,
        name: `${info.firstName || ""} ${info.lastName || ""}`.trim() || "Unknown",
        email: info.email || "",
        attemptCount: u.attemptCount,
        completedCount: u.completedCount,
        lastAttempt: u.lastAttempt,
      };
    });

    // PostHog login frequency (try, fallback gracefully)
    let loginFrequency = null;
    try {
      const loginResult = await hogqlQuery(`
        SELECT
          properties.$distinct_id as user_id,
          count() as login_count
        FROM events
        WHERE event = 'login_success'
          AND timestamp >= now() - interval ${getDateRange(req).days} day
        GROUP BY user_id
        ORDER BY login_count DESC
        LIMIT 20
      `);
      if (loginResult?.results) {
        loginFrequency = loginResult.results.map((row) => ({
          userId: row[0],
          loginCount: row[1],
        }));
      }
    } catch (_) {
      // PostHog query unavailable – that's OK, we still have MongoDB data
    }

    res.json({
      success: true,
      data: {
        totalActiveUsers,
        returningUsers,
        returningRate:
          totalActiveUsers > 0
            ? Math.round((returningUsers / totalActiveUsers) * 100 * 10) / 10
            : 0,
        avgAttemptsPerUser,
        topUsers,
        loginFrequency,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/analytics/posthog/insights
 * Proxy for PostHog insights — used by the admin dashboard for charts.
 * Accepts a HogQL query string in ?query= param.
 */
exports.getPostHogInsights = async (req, res, next) => {
  try {
    if (!posthogConfigured()) {
      return res.json({
        success: true,
        data: null,
        message:
          'PostHog personal API key or project ID is not configured on the server. Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to enable this endpoint.',
      });
    }
    const { query, limit } = req.query;
    if (!query) {
      return res
        .status(400)
        .json({ success: false, message: "query parameter is required" });
    }
    const result = await hogqlQuery(query, parseInt(limit) || 1000);
    res.json({ success: true, data: result });
  } catch (err) {
    // Don't expose internal PostHog errors to client
    res.status(502).json({
      success: false,
      message: "Failed to fetch PostHog data",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};
