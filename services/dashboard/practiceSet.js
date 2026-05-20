const Question = require("../../models/Question");
const SprintPlan = require("../../models/SprintPlan");
const {
  SECTION_TOPICS,
  SECTION_WEIGHTS,
  expandTopicVariants,
  canonicalTopic,
  prettySection,
} = require("./examStructure");

/** Default difficulty distribution per task type. */
const DIFFICULTY_TARGETS = {
  topic_practice: { easy: 0.5, medium: 0.4, hard: 0.1 },
  reinforcement_dual_topic: { easy: 0.3, medium: 0.5, hard: 0.2 },
  section_mixed: { easy: 0.3, medium: 0.5, hard: 0.2 },
  secondary_section_practice: { easy: 0.4, medium: 0.4, hard: 0.2 },
  primary_section_reinforcement: { easy: 0.4, medium: 0.4, hard: 0.2 },
  timed_mixed_check: { easy: 0.3, medium: 0.5, hard: 0.2 },
};

function getDifficultyTargets(taskType, count) {
  const ratios = DIFFICULTY_TARGETS[taskType] || { easy: 0.4, medium: 0.4, hard: 0.2 };
  let easy = Math.round(ratios.easy * count);
  let hard = Math.round(ratios.hard * count);
  let medium = count - easy - hard;
  if (medium < 0) {
    // Edge case: rounding pushed easy+hard past count.
    medium = 0;
    if (easy + hard > count) {
      const overflow = easy + hard - count;
      // Trim from hard first, then easy.
      const fromHard = Math.min(hard, overflow);
      hard -= fromHard;
      easy -= overflow - fromHard;
    }
  }
  return { easy, medium, hard };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Collect IDs of questions used in any not-yet-completed task in the same plan.
 * Used to avoid recent repeats inside the active sprint.
 */
function getActiveSprintQuestionIds(plan, excludeTaskId) {
  const ids = new Set();
  for (const task of plan.tasks) {
    if (task.taskId === excludeTaskId) continue;
    const qs = task.attempt?.questionIds || [];
    for (const id of qs) ids.add(String(id));
  }
  return ids;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count approved questions in (section, examLevel) for a single topic. */
async function countQuestionsForTopic(topic, section, examLevel) {
  const variants = expandTopicVariants([topic]);
  const regexes = variants.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i"));
  return Question.countDocuments({
    status: "approved",
    examFamily: "cse",
    examLevel: { $in: [examLevel, "both"] },
    section,
    topic: { $in: regexes },
  });
}

/**
 * For topic-based tasks, swap any topic that has zero approved questions in
 * the bank for a different topic in the same section that does. Avoids topics
 * already assigned to other tasks in the plan so the sprint doesn't duplicate.
 *
 * Mutates nothing; returns `{ topics, changed }`. Caller is responsible for
 * persisting the new topics + title on the plan.
 */
async function resolveTopicsWithCoverage(task, examLevel, plan) {
  const original = task.topics || [];
  if (original.length === 0) return { topics: original, changed: false };

  // Topics already used elsewhere in this plan — skip to avoid duplicates.
  const usedElsewhere = new Set();
  for (const t of plan?.tasks || []) {
    if (t.taskId === task.taskId) continue;
    for (const topic of t.topics || []) {
      const c = canonicalTopic(topic);
      if (c) usedElsewhere.add(c);
    }
  }

  // Distinct topics that actually have approved questions in this section.
  const rawTopics = await Question.distinct("topic", {
    status: "approved",
    examFamily: "cse",
    examLevel: { $in: [examLevel, "both"] },
    section: task.section,
  });
  const available = Array.from(
    new Set(rawTopics.map((t) => canonicalTopic(t)).filter(Boolean))
  );

  const out = [];
  let changed = false;

  for (const topic of original) {
    const count = await countQuestionsForTopic(topic, task.section, examLevel);
    if (count > 0) {
      out.push(topic);
      continue;
    }
    // Need a replacement. Prefer one not used elsewhere and not already chosen.
    const chosenHere = new Set(out.map((t) => canonicalTopic(t)));
    const strict = available.find(
      (t) => !usedElsewhere.has(t) && !chosenHere.has(t)
    );
    const replacement = strict || available.find((t) => !chosenHere.has(t)) || null;
    if (replacement) {
      out.push(replacement);
      changed = true;
    } else {
      // No coverage anywhere in the section — keep original; caller will hit
      // the section-wide safety net or surface a 404.
      out.push(topic);
    }
  }

  return { topics: out, changed };
}

/**
 * Pull eligible questions from the bank for this task.
 */
async function fetchEligiblePool(task, examLevel) {
  const baseFilter = {
    status: "approved",
    examFamily: "cse",
    examLevel: { $in: [examLevel, "both"] },
  };

  if (task.type === "timed_mixed_check") {
    const sections = task.sections && task.sections.length > 0
      ? task.sections
      : Object.keys(SECTION_WEIGHTS[examLevel]);
    return Question.find({ ...baseFilter, section: { $in: sections } }).lean();
  }

  if (task.type === "topic_practice" || task.type === "reinforcement_dual_topic") {
    // Strict topic filter — widen with all known variants of each canonical
    // topic name so legacy question records still match. Match case-
    // insensitively so casing differences in the DB don't drop questions.
    if (task.topics && task.topics.length > 0) {
      const topicNames = expandTopicVariants(task.topics);
      const regexes = topicNames.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i"));
      const topicPool = await Question.find({
        ...baseFilter,
        section: task.section,
        topic: { $in: regexes },
      }).lean();
      if (topicPool.length > 0) return topicPool;
      // Coverage gap: the assigned topic has no approved questions in the
      // bank. Fall back to the broader section so the user still gets
      // practice in the same weak area instead of a blocked task.
    }
  }

  // section_mixed / secondary_section_practice / primary_section_reinforcement / fallbacks
  return Question.find({ ...baseFilter, section: task.section }).lean();
}

/**
 * Pick `target` questions of the requested difficulty, falling back to other
 * difficulties when the bucket is empty.
 */
function pickByDifficultyBucket(buckets, fillOrder, target) {
  const out = [];
  for (const diff of fillOrder) {
    while (buckets[diff].length > 0 && out.length < target) {
      out.push(buckets[diff].shift());
    }
    if (out.length >= target) break;
  }
  return out;
}

/**
 * Build difficulty-balanced selection from a ranked pool.
 */
function selectByDifficulty(pool, targets) {
  const buckets = { easy: [], medium: [], hard: [] };
  for (const q of pool) {
    const d = (q.difficulty || "medium").toLowerCase();
    if (buckets[d]) buckets[d].push(q);
    else buckets.medium.push(q);
  }
  shuffle(buckets.easy);
  shuffle(buckets.medium);
  shuffle(buckets.hard);

  const easy = pickByDifficultyBucket(buckets, ["easy", "medium", "hard"], targets.easy);
  const medium = pickByDifficultyBucket(buckets, ["medium", "easy", "hard"], targets.medium);
  const hard = pickByDifficultyBucket(buckets, ["hard", "medium", "easy"], targets.hard);

  return [...easy, ...medium, ...hard];
}

/**
 * For dual-topic tasks, balance topic distribution.
 */
function selectDualTopic(pool, task, count, targets) {
  const [t1, t2] = task.topics;
  const byTopic = { [t1]: [], [t2]: [] };
  for (const q of pool) {
    const ct = canonicalTopic(q.topic);
    if (ct === t1) byTopic[t1].push(q);
    else if (ct === t2) byTopic[t2].push(q);
  }

  const half = Math.floor(count / 2);
  const target1 = byTopic[t1].length >= half ? half : byTopic[t1].length;
  const target2 = count - target1;

  const sub1 = selectByDifficulty(byTopic[t1], applyTopicSplit(targets, target1));
  const sub2 = selectByDifficulty(byTopic[t2], applyTopicSplit(targets, target2));

  let combined = [...sub1, ...sub2];
  if (combined.length < count) {
    // Backfill from remaining pool.
    const usedIds = new Set(combined.map((q) => String(q._id)));
    const remaining = pool.filter((q) => !usedIds.has(String(q._id)));
    shuffle(remaining);
    combined = combined.concat(remaining.slice(0, count - combined.length));
  }
  return combined.slice(0, count);
}

function applyTopicSplit(targets, n) {
  const easy = Math.round((targets.easy / (targets.easy + targets.medium + targets.hard)) * n);
  const hard = Math.round((targets.hard / (targets.easy + targets.medium + targets.hard)) * n);
  return { easy, medium: Math.max(0, n - easy - hard), hard };
}

/**
 * For section_mixed and primary_section_reinforcement: spread across topics in
 * the section so the drill never collapses to one topic.
 */
function selectSectionSpread(pool, count, targets) {
  const byTopic = {};
  for (const q of pool) {
    const topic = canonicalTopic(q.topic) || "__notopic__";
    (byTopic[topic] = byTopic[topic] || []).push(q);
  }
  const topics = Object.keys(byTopic);
  topics.forEach((t) => shuffle(byTopic[t]));

  // Step 1 — at least 1 per topic if pool allows.
  const seeds = [];
  for (const t of topics) {
    if (seeds.length >= count) break;
    if (byTopic[t].length > 0) seeds.push(byTopic[t].shift());
  }
  // Step 2 — fill the rest using difficulty balance.
  const remainingPool = topics.flatMap((t) => byTopic[t]);
  const need = Math.max(0, count - seeds.length);
  const filler = selectByDifficulty(remainingPool, getDifficultyTargets("section_mixed", need));

  return [...seeds, ...filler].slice(0, count);
}

/**
 * For timed_mixed_check: weighted split across sections (4/3/2/1 for 10).
 */
function selectMixedSections(pool, count, examLevel, targets) {
  const weights = SECTION_WEIGHTS[examLevel];
  const sectionsSorted = Object.keys(weights).sort(
    (a, b) => weights[b] - weights[a]
  );
  const split = (() => {
    if (count === 10 && sectionsSorted.length === 4) return [4, 3, 2, 1];
    // Fallback proportional split
    const out = sectionsSorted.map((s) => Math.max(1, Math.round(weights[s] * count)));
    while (out.reduce((a, b) => a + b, 0) > count) {
      const idx = out.indexOf(Math.max(...out));
      out[idx] -= 1;
    }
    while (out.reduce((a, b) => a + b, 0) < count) {
      const idx = out.indexOf(Math.min(...out));
      out[idx] += 1;
    }
    return out;
  })();

  const bySection = {};
  for (const q of pool) {
    const sec = (q.section || "").toLowerCase().trim();
    (bySection[sec] = bySection[sec] || []).push(q);
  }

  const out = [];
  sectionsSorted.forEach((sec, idx) => {
    const need = split[idx];
    const sub = bySection[sec] || [];
    shuffle(sub);
    const subTargets = getDifficultyTargets("timed_mixed_check", need);
    const picked = selectByDifficulty(sub, subTargets);
    out.push(...picked);
  });

  if (out.length < count) {
    const usedIds = new Set(out.map((q) => String(q._id)));
    const remaining = pool.filter((q) => !usedIds.has(String(q._id)));
    shuffle(remaining);
    out.push(...remaining.slice(0, count - out.length));
  }
  return out.slice(0, count);
}

/**
 * Main: generate a practice set for a sprint task.
 *
 * @param {Object} params
 * @param {Object} params.task   plan task object
 * @param {string} params.examLevel
 * @param {Object} [params.plan] active SprintPlan (used to avoid repeats)
 * @returns {Promise<{ questions: Question[], difficultyMix }>}
 */
async function generatePracticeSet({ task, examLevel, plan }) {
  // Topic-based tasks: if the assigned topic has no questions, swap it for
  // another topic in the same section that does. Rewrites the task in place
  // so the caller can persist via plan.save().
  if (
    (task.type === "topic_practice" || task.type === "reinforcement_dual_topic") &&
    task.topics?.length > 0
  ) {
    const resolved = await resolveTopicsWithCoverage(task, examLevel, plan);
    if (resolved.changed) {
      task.topics = resolved.topics;
      // Mirror sprintEngine.buildTitle so the UI matches what we deliver.
      if (task.type === "topic_practice") {
        task.title = `${task.topics[0]} Practice`;
      } else if (task.type === "reinforcement_dual_topic") {
        task.title = `${prettySection(task.section)} Reinforcement Drill`;
      }
    }
  }

  const targets = getDifficultyTargets(task.type, task.questionCount);
  const pool = await fetchEligiblePool(task, examLevel);

  // Avoid questions used in other in-progress tasks of the same sprint.
  const exclude = plan ? getActiveSprintQuestionIds(plan, task.taskId) : new Set();
  let filtered = pool.filter((q) => !exclude.has(String(q._id)));

  // If filtering dropped the pool below count, allow repeats.
  if (filtered.length < task.questionCount) {
    filtered = pool;
  }

  let selected = [];
  if (task.type === "reinforcement_dual_topic" && task.topics?.length === 2) {
    selected = selectDualTopic(filtered, task, task.questionCount, targets);
  } else if (
    task.type === "section_mixed" ||
    task.type === "primary_section_reinforcement" ||
    task.type === "secondary_section_practice"
  ) {
    selected = selectSectionSpread(filtered, task.questionCount, targets);
  } else if (task.type === "timed_mixed_check") {
    selected = selectMixedSections(filtered, task.questionCount, examLevel, targets);
  } else {
    selected = selectByDifficulty(filtered, targets);
  }

  // Strict count enforcement (backfill from full pool if short).
  if (selected.length < task.questionCount) {
    const usedIds = new Set(selected.map((q) => String(q._id)));
    const remaining = pool.filter((q) => !usedIds.has(String(q._id)));
    shuffle(remaining);
    selected = selected.concat(
      remaining.slice(0, task.questionCount - selected.length)
    );
  }
  selected = selected.slice(0, task.questionCount);

  // Final shuffle for delivery order
  shuffle(selected);

  return {
    questions: selected,
    difficultyMix: targets,
  };
}

module.exports = {
  generatePracticeSet,
  getDifficultyTargets,
  DIFFICULTY_TARGETS,
};
