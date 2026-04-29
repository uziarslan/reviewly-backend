const { PASSING_SCORE, SAFE_ZONE } = require("./examStructure");

const READINESS_BADGE = {
  GETTING_READY: "Getting Ready",
  NEAR_PASSING: "Near Passing",
  SAFE_ZONE: "Safe Zone",
};

function getReadinessBadge(score, mode) {
  if (mode === "no_data" || score == null) return null;
  if (score < PASSING_SCORE) return READINESS_BADGE.GETTING_READY;
  if (score < SAFE_ZONE) return READINESS_BADGE.NEAR_PASSING;
  return READINESS_BADGE.SAFE_ZONE;
}

function getSupportingMessage(score, mode) {
  if (mode === "no_data") {
    return "Take your first exam to unlock your readiness score.";
  }
  if (mode === "assessment_only") {
    return "This is your starting point — take a full mock exam to validate your readiness.";
  }
  if (mode === "single_mock") {
    if (score < PASSING_SCORE) return "A few improvements can push you closer to passing.";
    if (score < SAFE_ZONE) return "You’re close to passing — keep building consistency.";
    return "You’re in a strong position — keep practicing to stay sharp.";
  }
  if (mode === "multi_mock") {
    if (score < PASSING_SCORE) return "Your recent mock results show there’s still a gap to close.";
    if (score < SAFE_ZONE) return "Your recent mocks show you’re getting close — stay on track.";
    return "Your recent mocks show you’re in a strong passing range.";
  }
  return "";
}

function modeFromSource(source) {
  if (source === "recent_full_mocks") return "multi_mock";
  if (source === "latest_full_mock") return "single_mock";
  if (source === "assessment") return "assessment_only";
  return "no_data";
}

function readinessLabel(mode) {
  if (mode === "assessment_only") return "Initial Readiness";
  if (mode === "single_mock" || mode === "multi_mock") return "Readiness Score";
  return null;
}

function sourceLabel(mode, mockCount) {
  if (mode === "assessment_only") return "Based on your initial assessment";
  if (mode === "single_mock") return "Based on your latest full mock";
  if (mode === "multi_mock") return `Based on your last ${mockCount} full mocks`;
  return null;
}

function getDaysBeforeExam(examDate) {
  if (!examDate) return null;
  const target = new Date(examDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  // Strip time-of-day to count whole days.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const ms = startOfTarget - startOfToday;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Compute the dashboard readiness payload from a resolved source bundle.
 *
 * @param {Object} bundle  output of getDashboardSourceBundle()
 * @param {Date|string|null} examDate  user's selected exam date (optional)
 */
function buildReadinessPayload(bundle, examDate = null) {
  const { source, attempts, aggregated, level } = bundle;
  const mode = modeFromSource(source);

  const daysBeforeExam = getDaysBeforeExam(examDate);

  if (mode === "no_data") {
    return {
      mode,
      examLevel: level,
      readinessScore: null,
      displayScore: null,
      badge: null,
      label: null,
      sourceLabel: null,
      passingScore: PASSING_SCORE,
      safeZone: SAFE_ZONE,
      daysBeforeExam,
      supportingMessage: getSupportingMessage(null, mode),
    };
  }

  const score = aggregated.totals.items > 0
    ? aggregated.totals.correct / aggregated.totals.items
    : 0;

  const mockCount = mode === "multi_mock" ? attempts.length : 1;

  return {
    mode,
    examLevel: level,
    readinessScore: score,
    displayScore: `${(score * 100).toFixed(2)}%`,
    badge: getReadinessBadge(score, mode),
    label: readinessLabel(mode),
    sourceLabel: sourceLabel(mode, mockCount),
    passingScore: PASSING_SCORE,
    safeZone: SAFE_ZONE,
    daysBeforeExam,
    supportingMessage: getSupportingMessage(score, mode),
  };
}

module.exports = {
  buildReadinessPayload,
  getReadinessBadge,
  getSupportingMessage,
  getDaysBeforeExam,
  modeFromSource,
};
