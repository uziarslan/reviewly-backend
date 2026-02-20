/**
 * Generate recommended next steps (CTAs) for exam results.
 * Logic follows the Results Page + AI Assessment spec.
 */

const SECTION_DISPLAY_NAMES = {
  verbal: "Verbal Ability",
  numerical: "Numerical Ability",
  analytical: "Analytical Ability",
  clerical: "Clerical Ability",
  "general information": "General Information",
};

/** Normalize section name for matching (lowercase, trimmed). */
function normalizeSection(s) {
  if (!s || typeof s !== "string") return "";
  return s.toLowerCase().trim();
}

/** Find practice reviewer that covers the given section. */
function findReviewerForSection(sectionName, practiceReviewers, examLevels) {
  const normalized = normalizeSection(sectionName);
  return practiceReviewers.find((r) => {
    const dist = r.examConfig?.sectionDistribution;
    if (!dist || !dist[0]) return false;
    const reviewerSection = normalizeSection(dist[0].section);
    if (reviewerSection !== normalized) return false;
    // Filter by exam level: Pro gets analytical, Sub-Prof gets clerical
    const levels = r.examConfig?.examLevel || [];
    if (!levels.length) return true;
    const hasOverlap = examLevels.some((l) =>
      levels.some((rl) => rl.toLowerCase() === l.toLowerCase() || rl === "both")
    );
    return hasOverlap;
  });
}

/**
 * Generate recommendations for full mock exam.
 * Sections with score < 75% get section practice CTAs. Add Retake Full Mock + Review Answers.
 */
function recommendationsForMock({ result, currentReviewer, practiceReviewers, mockReviewers }) {
  const ctas = [];
  const sectionScores = result.sectionScores || [];
  const examLevels = currentReviewer?.examConfig?.examLevel || ["professional", "both"];
  const totalItems = result.totalItems || 0;

  // Sections needing improvement (score < 75%), sorted by score ascending (lowest first)
  const weakSections = [...sectionScores]
    .filter((s) => s.score < 75)
    .sort((a, b) => a.score - b.score);

  const lowestSection = weakSections[0];

  for (const sec of weakSections) {
    const reviewer = findReviewerForSection(sec.section, practiceReviewers, examLevels);
    const isHighestImpact = lowestSection && sec.section === lowestSection.section;

    ctas.push({
      type: "take_section_practice",
      label: "Take Practice Exam",
      reviewerId: reviewer?._id || null,
      isHighestImpact,
      priority: sec.score < 60 ? "primary" : "secondary",
    });
  }

  // Retake Full Mock (use current reviewer - they just took that mock)
  const mockForRetake = currentReviewer?.type === "mock" ? currentReviewer : mockReviewers[0];
  if (mockForRetake) {
    ctas.push({
      type: "retake_full_mock",
      label: "Retake Full Exam",
      reviewerId: mockForRetake._id,
      isHighestImpact: false,
      priority: "secondary",
    });
  }

  return ctas;
}

/**
 * Generate recommendations for section practice exam.
 * CTA logic based on performance band per guidelines.
 */
function recommendationsForPractice({ result, currentReviewer, mockReviewers }) {
  const ctas = [];
  const performanceLevel = result.performanceLevel || "Needs Improvement";
  const mockReviewer = mockReviewers[0];

  ctas.push({
    type: "review_answers",
    label: "Review My Answers",
    reviewerId: null,
    isHighestImpact: false,
    priority: "primary",
  });

  if (currentReviewer) {
    ctas.push({
      type: "retake_section",
      label: "Retake Section Practice",
      reviewerId: currentReviewer._id,
      isHighestImpact: false,
      priority: performanceLevel === "Strong" ? "optional" : "secondary",
    });
  }

  if (mockReviewer) {
    ctas.push({
      type: "try_full_mock",
      label: "Try Full Mock Exam",
      reviewerId: mockReviewer._id,
      isHighestImpact: false,
      priority: performanceLevel === "Strong" ? "primary" : "optional",
    });
  }

  ctas.push({
    type: "go_to_dashboard",
    label: "Go Back to Dashboard",
    reviewerId: null,
    isHighestImpact: false,
    priority: "optional",
  });

  return ctas;
}

/**
 * Generate recommendations for demo exam.
 * Review My Answers (primary), Try Full Mock Exam (upgrade CTA), Go Back to Dashboard, Retake Demo (optional).
 */
function recommendationsForDemo({ mockReviewers, currentReviewer }) {
  const ctas = [];
  const mockReviewer = mockReviewers[0];

  ctas.push({
    type: "review_answers",
    label: "Review My Answers",
    reviewerId: null,
    isHighestImpact: false,
    priority: "primary",
  });

  if (mockReviewer) {
    ctas.push({
      type: "try_full_mock",
      label: "Try Full Mock Exam",
      reviewerId: mockReviewer._id,
      isHighestImpact: false,
      priority: "primary",
    });
  }

  ctas.push({
    type: "go_to_dashboard",
    label: "Go Back to Dashboard",
    reviewerId: null,
    isHighestImpact: false,
    priority: "optional",
  });

  if (currentReviewer) {
    ctas.push({
      type: "retake_demo",
      label: "Retake Demo",
      reviewerId: currentReviewer._id,
      isHighestImpact: false,
      priority: "optional",
    });
  }

  return ctas;
}

/**
 * Generate recommended next steps.
 * @param {Object} opts
 * @param {string} opts.examType - 'mock' | 'practice' | 'demo'
 * @param {Object} opts.result - attempt.result
 * @param {Object} opts.currentReviewer - populated reviewer for this attempt
 * @param {Array} opts.allReviewers - all published practice + mock reviewers
 */
function generateRecommendations({ examType, result, currentReviewer, allReviewers }) {
  const practiceReviewers = (allReviewers || []).filter((r) => r.type === "practice");
  const mockReviewers = (allReviewers || []).filter((r) => r.type === "mock");

  let ctas = [];

  if (examType === "mock") {
    ctas = recommendationsForMock({
      result,
      currentReviewer,
      practiceReviewers,
      mockReviewers,
    });
    ctas.push({
      type: "review_answers",
      label: "Review My Answers",
      reviewerId: null,
      isHighestImpact: false,
      priority: "secondary",
    });
  } else if (examType === "practice") {
    ctas = recommendationsForPractice({
      result,
      currentReviewer,
      mockReviewers,
    });
  } else if (examType === "demo") {
    ctas = recommendationsForDemo({
      mockReviewers,
      currentReviewer,
    });
  }

  return { ctas };
}

/**
 * Populate reviewer data for CTAs that have reviewerId.
 * Fetches reviewers from DB and attaches lean reviewer objects.
 * @param {Array} ctas - Array of CTA objects (with reviewerId)
 * @param {Function} ReviewerModel - Reviewer mongoose model
 * @returns {Promise<Array>} CTAs with reviewer populated where applicable
 */
async function populateRecommendationReviewers(ctas, ReviewerModel) {
  if (!ctas || !ctas.length) return ctas;

  const reviewerIds = [...new Set(
    ctas
      .filter((c) => c.reviewerId != null)
      .map((c) => (typeof c.reviewerId === "object" && c.reviewerId?.toString
        ? c.reviewerId.toString()
        : String(c.reviewerId)))
  )].filter(Boolean);

  if (reviewerIds.length === 0) return ctas;

  const reviewers = await ReviewerModel.find({ _id: { $in: reviewerIds } })
    .select("title logo details access examConfig")
    .lean();

  const reviewerMap = new Map(reviewers.map((r) => [r._id.toString(), r]));

  return ctas.map((c) => {
    const copy = { ...c };
    if (c.reviewerId != null) {
      const id = typeof c.reviewerId === "object" && c.reviewerId?.toString
        ? c.reviewerId.toString()
        : String(c.reviewerId);
      const r = reviewerMap.get(id);
      if (r) {
        const sectionKey = r.examConfig?.sectionDistribution?.[0]?.section;
        const sectionDisplayName = sectionKey
          ? (SECTION_DISPLAY_NAMES[normalizeSection(sectionKey)] || sectionKey)
          : (r.title?.match(/\(([^)]+)\)/)?.[1] || null);

        copy.reviewer = {
          _id: r._id,
          title: r.title,
          logo: r.logo,
          details: r.details || {},
          access: r.access || "free",
          sectionDisplayName,
        };
      }
    }
    return copy;
  });
}

module.exports = { generateRecommendations, populateRecommendationReviewers };
