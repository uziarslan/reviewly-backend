const Attempt = require("../../models/Attempt");

/**
 * Computes full-mock statistics for the dashboard widgets:
 *   - totalMocksTaken
 *   - improvementSinceFirst  (latestScore - firstScore)
 *   - bestFullMock
 *   - avgFullMock
 */
async function buildMockStats(userId, examLevel) {
  const attempts = await Attempt.find({
    user: userId,
    status: { $in: ["submitted", "timed_out"] },
  })
    .populate({ path: "reviewer", select: "type slug examConfig" })
    .sort({ submittedAt: 1 }) // oldest first so index 0 = first mock
    .select("reviewer result.percentage submittedAt")
    .lean();

  const mocks = attempts.filter((a) => {
    if (a.reviewer?.type !== "mock") return false;
    if (!examLevel) return true;
    const levels = a.reviewer?.examConfig?.examLevel || [];
    if (levels.includes(examLevel)) return true;
    const slug = a.reviewer?.slug || "";
    if (examLevel === "subprofessional" && slug.includes("subprofessional")) return true;
    if (examLevel === "professional" && slug.includes("professional") && !slug.includes("subprofessional")) return true;
    return false;
  });

  const total = mocks.length;

  if (total === 0) {
    return {
      hasData: false,
      totalMocksTaken: 0,
      improvementSinceFirst: null,
      bestFullMock: null,
      avgFullMock: null,
    };
  }

  const scores = mocks.map((a) => a.result?.percentage ?? 0);
  const firstScore = scores[0];
  const latestScore = scores[scores.length - 1];
  const best = Math.max(...scores);
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;

  let improvementSinceFirst = null;
  if (total >= 2) {
    const diff = parseFloat((latestScore - firstScore).toFixed(2));
    improvementSinceFirst = {
      value: diff,
      display: `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`,
      isPositive: diff >= 0,
    };
  }

  return {
    hasData: true,
    totalMocksTaken: total,
    improvementSinceFirst,
    bestFullMock: parseFloat(best.toFixed(2)),
    avgFullMock: parseFloat(avg.toFixed(2)),
  };
}

module.exports = { buildMockStats };
