const {
  SECTION_WEIGHTS,
  SECTION_TOPICS,
  getSectionsForLevel,
  prettySection,
} = require("./examStructure");

/** Status thresholds (per spec). */
function statusForScore(score) {
  if (score >= 0.85) return "Strong";
  if (score >= 0.70) return "Improving";
  return "Weak";
}

/** Action mapping (per spec). */
function actionForPriority(priority, status) {
  if (status === "Strong" && priority === "Medium") return "Maintain";
  if (priority === "High") return "Review Topics";
  if (priority === "Medium") return "Practice";
  return "Maintain";
}

/**
 * Build section + topic breakdown from a source bundle.
 * @param {Object} bundle  output of getDashboardSourceBundle()
 */
function buildSectionBreakdown(bundle) {
  const { source, level, aggregated, hasData, attempts } = bundle;
  const sectionsList = getSectionsForLevel(level);
  const weights = SECTION_WEIGHTS[level];

  if (!hasData) {
    // Empty-state breakdown — sections + topics with no values, used by UI.
    const sections = sectionsList.map((sec) => ({
      key: sec,
      label: prettySection(sec),
      score: null,
      scoreDisplay: "–",
      weight: weights[sec],
      weightDisplay: `${Math.round(weights[sec] * 100)}%`,
      status: null,
      priority: null,
      action: null,
      result: "–",
      correct: 0,
      items: 0,
      topics: (SECTION_TOPICS[sec] || []).map((name) => ({
        name,
        score: null,
        scoreDisplay: "–",
        result: "–",
        status: null,
      })),
    }));
    return {
      source,
      hasData: false,
      sections,
      subtitle: "Take an exam to unlock your performance breakdown and weakest areas.",
      footnote: "Take a full mock to validate your progress.",
    };
  }

  // Compute priority scores (used to bucket High/Medium/Low).
  const priorityScores = sectionsList.map((sec) => {
    const stats = aggregated.sections[sec] || { correct: 0, items: 0, score: 0 };
    return {
      key: sec,
      priorityScore: weights[sec] * (1 - stats.score),
    };
  });
  // Sort descending by priority score.
  const sortedByPriority = [...priorityScores].sort(
    (a, b) => b.priorityScore - a.priorityScore
  );
  const priorityRank = {};
  sortedByPriority.forEach((entry, idx) => {
    if (idx === 0) priorityRank[entry.key] = "High";
    else if (idx === sortedByPriority.length - 1) priorityRank[entry.key] = "Low";
    else priorityRank[entry.key] = "Medium";
  });

  const sections = sectionsList.map((sec) => {
    const stats = aggregated.sections[sec] || { correct: 0, items: 0, score: 0 };
    const status = stats.items > 0 ? statusForScore(stats.score) : null;
    const priority = priorityRank[sec];
    const action = actionForPriority(priority, status);

    const expectedTopics = SECTION_TOPICS[sec] || [];
    const topicMap = aggregated.topics[sec] || {};

    // Show the canonical topic list. If the source has no data for a topic, it shows "–".
    const seenTopicNames = new Set();
    const topics = expectedTopics.map((name) => {
      const t = topicMap[name];
      seenTopicNames.add(name);
      if (!t || t.items === 0) {
        return {
          name,
          score: null,
          scoreDisplay: "–",
          result: "–",
          status: null,
        };
      }
      return {
        name,
        score: t.score,
        scoreDisplay: `${Math.round(t.score * 100)}%`,
        result: `${t.correct}/${t.items}`,
        status: statusForScore(t.score),
      };
    });

    // Surface any extra topics that came from data but aren't in the canonical list.
    for (const extraName of Object.keys(topicMap)) {
      if (seenTopicNames.has(extraName)) continue;
      const t = topicMap[extraName];
      topics.push({
        name: extraName,
        score: t.score,
        scoreDisplay: `${Math.round(t.score * 100)}%`,
        result: `${t.correct}/${t.items}`,
        status: statusForScore(t.score),
      });
    }

    return {
      key: sec,
      label: prettySection(sec),
      score: stats.items > 0 ? stats.score : null,
      scoreDisplay: stats.items > 0 ? `${Math.round(stats.score * 100)}%` : "–",
      weight: weights[sec],
      weightDisplay: `${Math.round(weights[sec] * 100)}%`,
      status,
      priority,
      action,
      result: stats.items > 0 ? `${stats.correct}/${stats.items}` : "–",
      correct: stats.correct,
      items: stats.items,
      topics,
    };
  });

  let subtitle;
  let footnote;
  if (source === "assessment") {
    subtitle = "Your performance breakdown based on your assessment.";
    footnote = "Take a full mock to validate your progress.";
  } else if (source === "latest_full_mock") {
    subtitle = "Your performance breakdown based on your latest full mock.";
    footnote = "Retake a full mock to measure your improvement.";
  } else {
    subtitle = `Your performance breakdown based on your last ${attempts.length} full mocks.`;
    footnote = "Retake a full mock to measure your improvement.";
  }

  return {
    source,
    hasData: true,
    sections,
    subtitle,
    footnote,
  };
}

module.exports = {
  buildSectionBreakdown,
  statusForScore,
  actionForPriority,
};
