const {
  SECTION_WEIGHTS,
  SECTION_TOPICS,
  SECTION_TIE_BREAK_ORDER,
  prettySection,
} = require("./examStructure");

/**
 * 7-Day Sprint Generator (V1.2)
 * Rule-based, deterministic for the same input.
 */

function topicLabel(score) {
  if (score < 0.70) return "Weak topic";
  if (score < 0.85) return "Improving";
  return "Strong";
}

function sectionLabel(score) {
  if (score < 0.70) return "Weak section";
  if (score < 0.85) return "Improving";
  return "Strong";
}

/**
 * Rank sections by priority (weight * (1 - score)) DESC.
 * Tie breakers: higher weight, lower score, fixed canonical order.
 */
function rankSections(sectionStats, level) {
  const weights = SECTION_WEIGHTS[level];
  const order = SECTION_TIE_BREAK_ORDER[level];
  const fixedRank = (sec) => {
    const idx = order.indexOf(sec);
    return idx === -1 ? order.length : idx;
  };

  return Object.keys(sectionStats)
    .filter((sec) => weights[sec] != null)
    .map((sec) => ({
      section: sec,
      score: sectionStats[sec].score,
      weight: weights[sec],
      priority: weights[sec] * (1 - sectionStats[sec].score),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.score !== b.score) return a.score - b.score;
      return fixedRank(a.section) - fixedRank(b.section);
    });
}

/**
 * Rank topics within a section by (1 - topic_score) DESC.
 * Tie breakers: lower score, higher item count, alphabetical order.
 */
function rankTopics(sectionKey, topicStats /*{[name]:{correct,items,score}}*/) {
  const expected = SECTION_TOPICS[sectionKey] || [];
  const known = new Set(expected);

  // Topics seen in source data
  const seenTopics = Object.keys(topicStats || {}).map((name) => ({
    name,
    score: topicStats[name].score,
    items: topicStats[name].items,
    inCanonical: known.has(name),
  }));

  // Topics that exist in canon but never appeared (treat as score 0, lowest items)
  const unseenCanonical = expected
    .filter((name) => !topicStats[name])
    .map((name) => ({ name, score: 0, items: 0, inCanonical: true }));

  const all = [...seenTopics, ...unseenCanonical];

  all.sort((a, b) => {
    const pa = 1 - a.score;
    const pb = 1 - b.score;
    if (pb !== pa) return pb - pa;
    if (a.score !== b.score) return a.score - b.score;
    if (b.items !== a.items) return b.items - a.items;
    return a.name.localeCompare(b.name);
  });

  return all;
}

function buildTitle(type, sectionKey, topics) {
  const sec = prettySection(sectionKey);
  switch (type) {
    case "topic_practice":
      return `${topics[0]} Practice`;
    case "reinforcement_dual_topic":
      return `${sec} Reinforcement Drill`;
    case "section_mixed":
      return `${sec} Mixed Drill`;
    case "secondary_section_practice":
      return `${sec} Practice`;
    case "primary_section_reinforcement":
      return `Reinforce ${sec} Weak Areas`;
    case "timed_mixed_check":
      return "Timed Mixed Check";
    default:
      return `${sec} Practice`;
  }
}

function pickTaskLabel(type, primaryStats, weakTopic1, weakTopic2) {
  switch (type) {
    case "topic_practice":
      return topicLabel(weakTopic1?.score ?? 0);
    case "reinforcement_dual_topic":
      return "Reinforce weak areas";
    case "section_mixed":
      return sectionLabel(primaryStats?.score ?? 0);
    case "secondary_section_practice":
      return "Secondary focus";
    case "primary_section_reinforcement":
      return "Accuracy boost";
    case "timed_mixed_check":
      return "Check your stability";
    default:
      return sectionLabel(primaryStats?.score ?? 0);
  }
}

const QUESTION_COUNT_BY_TYPE = {
  topic_practice: 10,
  reinforcement_dual_topic: 8,
  section_mixed: 10,
  secondary_section_practice: 10,
  primary_section_reinforcement: 10,
  timed_mixed_check: 10,
};

function estimatedMinutes(qCount) {
  return Math.max(1, Math.round(qCount * 0.6));
}

/**
 * Build the 7-task plan from a source bundle.
 * @param {Object} bundle  output of getDashboardSourceBundle()
 * @returns {Object|null}  plan-shape suitable for SprintPlan.create
 */
function generateSprintPlan(bundle) {
  if (!bundle.hasData) return null;

  const { level, aggregated, source, attempts } = bundle;

  // Step 1 — rank sections.
  const ranked = rankSections(aggregated.sections, level);
  if (ranked.length === 0) return null;

  const primary = ranked[0];
  const secondary = ranked[1] || ranked[0]; // edge: only 1 section

  // Step 2 — rank topics in the primary section.
  const primaryTopicStats = aggregated.topics[primary.section] || {};
  const rankedTopics = rankTopics(primary.section, primaryTopicStats);
  const weakTopic1 = rankedTopics[0];
  const weakTopic2 = rankedTopics[1] || rankedTopics[0];

  // Step 3 — build 7 tasks (deterministic, fixed sequence).
  const taskDefs = [
    {
      day: 1,
      type: "topic_practice",
      section: primary.section,
      topics: weakTopic1 ? [weakTopic1.name] : [],
    },
    {
      day: 2,
      type: "topic_practice",
      section: primary.section,
      topics: weakTopic2 ? [weakTopic2.name] : (weakTopic1 ? [weakTopic1.name] : []),
    },
    {
      day: 3,
      type: "reinforcement_dual_topic",
      section: primary.section,
      topics: [weakTopic1?.name, weakTopic2?.name].filter(Boolean),
    },
    {
      day: 4,
      type: "section_mixed",
      section: primary.section,
      topics: [],
    },
    {
      day: 5,
      type: "secondary_section_practice",
      section: secondary.section,
      topics: [],
    },
    {
      day: 6,
      type: "primary_section_reinforcement",
      section: primary.section,
      topics: [],
    },
    {
      day: 7,
      type: "timed_mixed_check",
      section: primary.section, // anchor; sections array spans all
      topics: [],
      sections: Object.keys(SECTION_WEIGHTS[level]),
    },
  ];

  const primaryStats = aggregated.sections[primary.section];

  const tasks = taskDefs.map((d, idx) => {
    const qCount = QUESTION_COUNT_BY_TYPE[d.type];
    return {
      taskId: `task_${idx + 1}`,
      day: d.day,
      type: d.type,
      title: buildTitle(d.type, d.section, d.topics),
      section: d.section,
      sections: d.sections || [],
      topics: d.topics,
      questionCount: qCount,
      estimatedMinutes: estimatedMinutes(qCount),
      label: pickTaskLabel(d.type, primaryStats, weakTopic1, weakTopic2),
      status: "not_started",
    };
  });

  return {
    examLevel: level,
    sourceType: source === "assessment" ? "assessment"
      : source === "latest_full_mock" ? "mock_exam"
      : "recent_full_mocks",
    sourceAttempts: attempts.map((a) => a._id),
    primarySection: primary.section,
    secondarySection: secondary?.section || null,
    tasks,
  };
}

module.exports = {
  generateSprintPlan,
  rankSections,
  rankTopics,
  QUESTION_COUNT_BY_TYPE,
  estimatedMinutes,
  topicLabel,
  sectionLabel,
};
