/**
 * Exam structure: sections, weights, and topics per exam level.
 * Section keys are stored lowercase (matches Question.section / Attempt.sectionScores).
 * Display labels mirror the trial-assessment seed.
 */

const SECTION_WEIGHTS = {
  professional: {
    verbal: 0.30,
    analytical: 0.35,
    numerical: 0.30,
    "general information": 0.05,
  },
  subprofessional: {
    verbal: 0.30,
    clerical: 0.35,
    numerical: 0.30,
    "general information": 0.05,
  },
};

const SECTION_LABELS = {
  verbal: "Verbal",
  analytical: "Analytical",
  clerical: "Clerical",
  numerical: "Numerical",
  "general information": "General Information",
};

const SECTION_FOCUS_LABELS = {
  verbal: "Verbal Ability",
  analytical: "Analytical Ability",
  clerical: "Clerical Ability",
  numerical: "Numerical Ability",
  "general information": "General Information",
};

// Topic taxonomy. Keys are normalised lower-case section keys.
// Topic display strings are the canonical display names shown in the
// Section + Topic Breakdown table.
const SECTION_TOPICS = {
  verbal: [
    "Word Meaning",
    "Sentence Completion",
    "Error Recognition",
    "Sentence Structure",
    "Paragraph Organization",
    "Reading Comprehension",
  ],
  analytical: [
    "Word Analogy",
    "Symbolic Logic / Abstract Reasoning",
    "Identifying Assumption And Drawing Conclusion",
    "Data Interpretation",
  ],
  clerical: ["Filing", "Spelling"],
  numerical: ["Basic Operations", "Number Sequence", "Word Problems"],
  "general information": [
    "Philippine Constitution",
    "Code Of Conduct (R.A. 6713)",
    "Peace And Human Rights Issues And Concepts",
    "Environment Management And Protection",
  ],
};

/**
 * Map legacy / shorthand topic names that may live on Question records
 * to the canonical display names used in the breakdown table. Lookups are
 * case-insensitive on the *trimmed* topic string.
 */
const TOPIC_ALIASES = {
  // analytical
  "identifying assumption and drawing conclusion":
    "Identifying Assumption And Drawing Conclusion",

  // general information — long-form display names
  "ra 6713 ethics": "Code Of Conduct (R.A. 6713)",
  "ra 6713": "Code Of Conduct (R.A. 6713)",
  "code of conduct": "Code Of Conduct (R.A. 6713)",
  "code of conduct (ra 6713)": "Code Of Conduct (R.A. 6713)",
  "code of conduct (r.a. 6713)": "Code Of Conduct (R.A. 6713)",
  "peace and human rights": "Peace And Human Rights Issues And Concepts",
  "peace and human rights issues and concepts":
    "Peace And Human Rights Issues And Concepts",
  "environment management": "Environment Management And Protection",
  "environment management and protection":
    "Environment Management And Protection",
};

/** Normalise a question's topic string to its canonical display name. */
function canonicalTopic(topicRaw) {
  const t = (topicRaw || "").trim();
  if (!t) return "";
  const key = t.toLowerCase();
  return TOPIC_ALIASES[key] || t;
}

/**
 * Reverse alias index: canonical display name → [list of known variant names].
 * Used to widen MongoDB `topic: { $in: ... }` queries so we still match
 * legacy question records with shorter / older topic strings.
 */
const TOPIC_VARIANTS = (() => {
  const out = {};
  for (const [legacyKey, canonical] of Object.entries(TOPIC_ALIASES)) {
    if (!out[canonical]) out[canonical] = new Set([canonical]);
    out[canonical].add(legacyKey);
    // Add Title-Case form of the legacy key as another variant.
    const titled = legacyKey.replace(/\b\w/g, (c) => c.toUpperCase());
    out[canonical].add(titled);
  }
  // Convert sets → arrays.
  for (const k of Object.keys(out)) out[k] = Array.from(out[k]);
  return out;
})();

/** Expand a list of canonical topic names to include all known variants. */
function expandTopicVariants(topics) {
  const out = new Set();
  for (const t of topics || []) {
    if (!t) continue;
    out.add(t);
    const v = TOPIC_VARIANTS[t];
    if (v) for (const variant of v) out.add(variant);
  }
  return Array.from(out);
}

// Tie-break order when two sections share a priority score.
const SECTION_TIE_BREAK_ORDER = {
  professional: ["verbal", "analytical", "numerical", "general information"],
  subprofessional: ["verbal", "clerical", "numerical", "general information"],
};

const PASSING_SCORE = 0.80;
const SAFE_ZONE = 0.85;

/** Get sections for an exam level, ordered by canonical sequence. */
function getSectionsForLevel(level) {
  const weights = SECTION_WEIGHTS[level] || SECTION_WEIGHTS.professional;
  return Object.keys(weights);
}

/** Title-case helper for fallback labels (kept simple). */
function prettySection(key) {
  return SECTION_LABELS[key] || key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function focusSection(key) {
  return SECTION_FOCUS_LABELS[key] || prettySection(key);
}

module.exports = {
  SECTION_WEIGHTS,
  SECTION_LABELS,
  SECTION_FOCUS_LABELS,
  SECTION_TOPICS,
  SECTION_TIE_BREAK_ORDER,
  TOPIC_ALIASES,
  TOPIC_VARIANTS,
  PASSING_SCORE,
  SAFE_ZONE,
  getSectionsForLevel,
  prettySection,
  focusSection,
  canonicalTopic,
  expandTopicVariants,
};
