const Attempt = require("../../models/Attempt");
const { getSectionsForLevel, canonicalTopic } = require("./examStructure");

/**
 * Question fields needed for aggregation. Skipping heavy text fields keeps
 * the dashboard endpoint cheap.
 */
const QUESTION_LITE_FIELDS = "section topic correctAnswer";

/**
 * Find the user's most recent submitted attempt of a given reviewer type.
 *
 * Returns the attempts populated with reviewer (full doc) and questions
 * limited to fields needed for aggregation.
 */
async function findLatestAttemptsByReviewerType(userId, reviewerType, limit = 3) {
  const attempts = await Attempt.find({
    user: userId,
    status: { $in: ["submitted", "timed_out"] },
  })
    .populate({ path: "reviewer", select: "type slug examConfig" })
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(50)
    .lean();

  const matched = attempts
    .filter((a) => a.reviewer?.type === reviewerType)
    .slice(0, limit);

  if (matched.length === 0) return [];

  // Hydrate questions only for matched attempts (lite fields).
  const matchedIds = matched.map((a) => a._id);
  const hydrated = await Attempt.find({ _id: { $in: matchedIds } })
    .populate({ path: "reviewer", select: "type slug examConfig" })
    .populate({ path: "questions", select: QUESTION_LITE_FIELDS })
    .lean();

  // Preserve original order (most-recent first).
  const orderById = new Map(matchedIds.map((id, idx) => [String(id), idx]));
  hydrated.sort(
    (a, b) => orderById.get(String(a._id)) - orderById.get(String(b._id))
  );
  return hydrated;
}

async function getLatestAssessmentAttempt(userId) {
  const list = await findLatestAttemptsByReviewerType(userId, "trial_assessment", 1);
  return list[0] || null;
}

async function getRecentFullMocks(userId, limit = 3) {
  return findLatestAttemptsByReviewerType(userId, "mock", limit);
}

/**
 * Source priority rule:
 *   2+ mocks → recent_full_mocks (latest 3)
 *   1 mock  → latest_full_mock
 *   else    → assessment (if any)
 *   else    → no_data
 */
async function resolveBestSource(userId) {
  const mocks = await getRecentFullMocks(userId, 3);

  if (mocks.length >= 2) {
    return { source: "recent_full_mocks", attempts: mocks };
  }
  if (mocks.length === 1) {
    return { source: "latest_full_mock", attempts: mocks };
  }

  const assessment = await getLatestAssessmentAttempt(userId);
  if (assessment) {
    return { source: "assessment", attempts: [assessment] };
  }

  return { source: "no_data", attempts: [] };
}

/**
 * Derive examLevel ("professional"|"subprofessional") from the most recent
 * mock or assessment. Defaults to "professional" when no signal is available.
 */
async function detectExamLevel(userId) {
  const mocks = await getRecentFullMocks(userId, 1);
  const newest = mocks[0] || (await getLatestAssessmentAttempt(userId));
  if (!newest) return "professional";

  const levels = newest.reviewer?.examConfig?.examLevel || [];
  if (levels.includes("subprofessional") && !levels.includes("professional")) {
    return "subprofessional";
  }
  if (levels.includes("professional")) return "professional";

  const slug = newest.reviewer?.slug || "";
  if (slug.includes("sub")) return "subprofessional";
  return "professional";
}

/**
 * Build per-section / per-topic aggregation across attempts (pooled totals).
 */
function aggregateAcrossAttempts(attempts) {
  const sections = {};
  const topics = {};
  let totalCorrect = 0;
  let totalItems = 0;

  for (const attempt of attempts) {
    const questions = attempt.questions || [];
    const answers = attempt.answers || [];

    questions.forEach((q, idx) => {
      const sec = (q.section || "other").toLowerCase().trim();
      const topic = canonicalTopic(q.topic);
      const ans = answers[idx];
      const isCorrect = !!(ans && ans.isCorrect);

      if (!sections[sec]) sections[sec] = { correct: 0, items: 0 };
      sections[sec].items += 1;
      if (isCorrect) sections[sec].correct += 1;

      if (topic) {
        if (!topics[sec]) topics[sec] = {};
        if (!topics[sec][topic]) topics[sec][topic] = { correct: 0, items: 0 };
        topics[sec][topic].items += 1;
        if (isCorrect) topics[sec][topic].correct += 1;
      }

      totalItems += 1;
      if (isCorrect) totalCorrect += 1;
    });
  }

  for (const sec of Object.keys(sections)) {
    const s = sections[sec];
    s.score = s.items > 0 ? s.correct / s.items : 0;
  }
  for (const sec of Object.keys(topics)) {
    for (const t of Object.keys(topics[sec])) {
      const tt = topics[sec][t];
      tt.score = tt.items > 0 ? tt.correct / tt.items : 0;
    }
  }

  return {
    sections,
    topics,
    totals: { correct: totalCorrect, items: totalItems },
  };
}

/**
 * One-shot bundle used by every dashboard service.
 */
async function getDashboardSourceBundle(userId) {
  const [{ source, attempts }, level] = await Promise.all([
    resolveBestSource(userId),
    detectExamLevel(userId),
  ]);

  const aggregated = aggregateAcrossAttempts(attempts);

  // Ensure every canonical section appears (zeroed if absent).
  const allSections = getSectionsForLevel(level);
  for (const sec of allSections) {
    if (!aggregated.sections[sec]) {
      aggregated.sections[sec] = { correct: 0, items: 0, score: 0 };
    }
  }

  return {
    source,
    attempts,
    level,
    aggregated,
    hasData: source !== "no_data",
  };
}

module.exports = {
  getLatestAssessmentAttempt,
  getRecentFullMocks,
  resolveBestSource,
  detectExamLevel,
  aggregateAcrossAttempts,
  getDashboardSourceBundle,
};
