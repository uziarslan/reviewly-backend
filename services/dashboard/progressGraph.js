const Attempt = require("../../models/Attempt");
const { SAFE_ZONE } = require("./examStructure");

/**
 * Returns the last 5 submitted full mock attempts for the user's exam level,
 * oldest-first so the chart reads left-to-right.
 */
async function buildProgressGraph(userId, examLevel) {
  const attempts = await Attempt.find({
    user: userId,
    status: { $in: ["submitted", "timed_out"] },
  })
    .populate({ path: "reviewer", select: "type slug examConfig" })
    .sort({ submittedAt: -1 })
    .limit(50)
    .select("reviewer result.percentage submittedAt")
    .lean();

  const mocks = attempts
    .filter((a) => a.reviewer?.type === "mock")
    .filter((a) => {
      if (!examLevel) return true;
      const levels = a.reviewer?.examConfig?.examLevel || [];
      if (levels.includes(examLevel)) return true;
      const slug = a.reviewer?.slug || "";
      if (examLevel === "subprofessional" && slug.includes("subprofessional")) return true;
      if (examLevel === "professional" && slug.includes("professional") && !slug.includes("subprofessional")) return true;
      return false;
    })
    .slice(0, 5)
    .reverse(); // oldest → newest for the chart

  if (mocks.length === 0) {
    return { hasData: false, dataPoints: [], goalLine: Math.round(SAFE_ZONE * 100) };
  }

  const dataPoints = mocks.map((a) => {
    const d = a.submittedAt ? new Date(a.submittedAt) : new Date(a.createdAt);
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    return {
      attemptId: String(a._id),
      date,
      percentage: Math.round(a.result?.percentage ?? 0),
    };
  });

  return {
    hasData: true,
    dataPoints,
    goalLine: Math.round(SAFE_ZONE * 100),
  };
}

module.exports = { buildProgressGraph };
