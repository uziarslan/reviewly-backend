const {
  SECTION_WEIGHTS,
  PASSING_SCORE,
  focusSection,
  getSectionsForLevel,
} = require("./examStructure");

/**
 * Recommended Focus = section with highest (gap_to_pass × section_weight).
 * Returns null when there is no source data.
 */
function buildRecommendedFocus(bundle) {
  if (!bundle.hasData) return null;

  const { level, aggregated } = bundle;
  const sectionsList = getSectionsForLevel(level);
  const weights = SECTION_WEIGHTS[level];

  let best = null;
  for (const sec of sectionsList) {
    const stats = aggregated.sections[sec] || { score: 0 };
    const gap = Math.max(0, PASSING_SCORE - stats.score);
    const priority = gap * weights[sec];

    if (
      !best ||
      priority > best.priority ||
      (priority === best.priority && weights[sec] > best.weight)
    ) {
      best = {
        key: sec,
        label: focusSection(sec),
        score: stats.score,
        gap,
        gapDisplay: `${Math.round(gap * 100)}%`,
        weight: weights[sec],
        weightDisplay: `${Math.round(weights[sec] * 100)}%`,
        priority,
      };
    }
  }

  if (!best) return null;

  return {
    section: best.label,
    sectionKey: best.key,
    gapToPass: best.gap,
    gapDisplay: best.gapDisplay,
    sectionWeight: best.weight,
    weightDisplay: best.weightDisplay,
    reason: "Improving this section will raise your next mock score the fastest.",
  };
}

module.exports = { buildRecommendedFocus };
