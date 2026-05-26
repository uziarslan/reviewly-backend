const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");
const Reviewer = require("../models/Reviewer");
const Question = require("../models/Question");
const Attempt = require("../models/Attempt");
const { cloudinary } = require("../cloudinary");
const { generateRecommendations, populateRecommendationReviewers } = require("../utils/recommendations");

// ─── helpers ──────────────────────────────────────

/** Shuffle array in place (Fisher-Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Max questions drawn from a single topic per section. */
const MAX_PER_TOPIC = 3;

/**
 * Select `count` questions from `pool` trying to match difficulty %
 * while spreading across topics (max MAX_PER_TOPIC per topic).
 * diffDist = { easy: 30, medium: 50, hard: 20 } (percentages)
 */
function selectWithTopicAndDifficulty(pool, count, diffDist) {
  // Step 1: Build a diverse candidate pool — max MAX_PER_TOPIC per topic.
  const byTopic = {};
  pool.forEach((q) => {
    const topic = (q.topic || "__other__").toLowerCase().trim();
    if (!byTopic[topic]) byTopic[topic] = [];
    byTopic[topic].push(q);
  });
  Object.values(byTopic).forEach((arr) => shuffle(arr));

  const diversePool = [];
  for (const topicQuestions of Object.values(byTopic)) {
    let taken = 0;
    for (const q of topicQuestions) {
      if (taken >= MAX_PER_TOPIC) break;
      diversePool.push(q);
      taken++;
    }
  }

  // Step 2: Apply difficulty distribution on the diverse pool.
  const easyTarget = Math.round((diffDist.easy / 100) * count);
  const hardTarget = Math.round((diffDist.hard / 100) * count);
  const medTarget = count - easyTarget - hardTarget;

  const buckets = { easy: [], medium: [], hard: [] };
  diversePool.forEach((q) => {
    const d = q.difficulty?.toLowerCase() || "medium";
    if (buckets[d]) buckets[d].push(q);
    else buckets.medium.push(q);
  });

  shuffle(buckets.easy);
  shuffle(buckets.medium);
  shuffle(buckets.hard);

  const selected = [];
  selected.push(...buckets.easy.slice(0, easyTarget));
  selected.push(...buckets.medium.slice(0, medTarget));
  selected.push(...buckets.hard.slice(0, hardTarget));

  // If still short (diverse pool couldn't fill all buckets), fill from full pool.
  if (selected.length < count) {
    const selectedIds = new Set(selected.map((q) => q._id.toString()));
    const remaining = pool.filter((q) => !selectedIds.has(q._id.toString()));
    shuffle(remaining);
    selected.push(...remaining.slice(0, count - selected.length));
  }

  return selected.slice(0, count);
}

// ─── Start an exam (generate attempt) ───────────

/**
 * POST /api/exams/:reviewerId/start
 * Generates questions according to exam assembly logic, stores an Attempt.
 */
exports.startExam = async (req, res, next) => {
  try {
    const reviewer = await Reviewer.findById(req.params.reviewerId);
    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Reviewer not found" });
    }

    // Block trial_assessment from the normal exam flow
    if (reviewer.type === "trial_assessment") {
      return res
        .status(400)
        .json({ success: false, message: "Use the trial assessment endpoint" });
    }

    const cfg = reviewer.examConfig;
    if (!cfg) {
      return res
        .status(400)
        .json({ success: false, message: "Reviewer has no exam config" });
    }

    // Find any in-progress attempt for this user + reviewer
    const forceRestart = req.body?.restart === true;
    const retakeFrom = req.body?.retakeFrom || null;
    let attempt = await Attempt.findOne({
      user: req.user._id,
      reviewer: reviewer._id,
      status: "in_progress",
    });

    // Resume in-progress attempt unless caller explicitly wants a fresh start
    if (!forceRestart && !retakeFrom && attempt) {
      await attempt.populate("questions");
      return res.json({
        success: true,
        message: "Resuming existing attempt",
        data: formatAttemptForClient(attempt),
      });
    }

    // Delete the abandoned in-progress attempt so it doesn't pollute history
    if ((forceRestart || retakeFrom) && attempt) {
      await Attempt.deleteOne({ _id: attempt._id });
    }

    // Assemble questions for a new attempt
    let questionIds = [];

    if (retakeFrom) {
      // Retake: reuse the exact same questions in the same order from the specified attempt
      const source = await Attempt.findOne({
        _id: retakeFrom,
        user: req.user._id,
        reviewer: reviewer._id,
      }).select("questions");
      if (source && source.questions.length > 0) {
        questionIds = source.questions;
      } else {
        const selected = await assembleDynamic(cfg);
        questionIds = selected.map((q) => q._id);
      }
    } else if (cfg.variant === "fixed") {
      // Fixed exams reuse the same question set across retakes — pull from any prior attempt
      const prior = await Attempt.findOne({
        user: req.user._id,
        reviewer: reviewer._id,
      }).sort({ createdAt: -1 }).select("questions");
      if (prior && prior.questions.length > 0) {
        questionIds = prior.questions;
      } else {
        const selected = await assembleDynamic(cfg);
        questionIds = selected.map((q) => q._id);
      }
    } else {
      const selected = await assembleDynamic(cfg);
      questionIds = selected.map((q) => q._id);
    }

    const answersArray = questionIds.map((qId) => ({
      question: qId,
      selectedAnswer: null,
      isCorrect: false,
    }));

    const newAttemptData = {
      user: req.user._id,
      reviewer: reviewer._id,
      questions: questionIds,
      answers: answersArray,
      status: "in_progress",
      currentIndex: 0,
      startedAt: new Date(),
      submittedAt: null,
      remainingSeconds: cfg.timeLimitSeconds || null,
      result: {
        totalItems: 0,
        correct: 0,
        incorrect: 0,
        unanswered: 0,
        percentage: 0,
        passed: false,
        passingScore: null,
        sectionScores: [],
        strengths: [],
        improvements: [],
      },
    };

    attempt = await createAttemptWithIndexFallback(newAttemptData);

    await attempt.populate("questions");

    res.status(201).json({
      success: true,
      data: formatAttemptForClient(attempt),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create an attempt with two self-healing fallbacks:
 *
 * 1. Legacy index (user_1_reviewer_1): drop it and retry — one-time migration.
 * 2. Race-condition guard index (user_reviewer_in_progress_unique): a concurrent
 *    request already created an in-progress attempt (e.g. React StrictMode double
 *    effect). Return the existing one instead of failing.
 */
async function createAttemptWithIndexFallback(data) {
  try {
    return await Attempt.create(data);
  } catch (err) {
    if (err.code !== 11000) throw err;

    // ── Fallback 1: legacy unique index ──────────────────────────────────────
    if (err.message && err.message.includes('user_1_reviewer_1')) {
      logger.warn('Dropping legacy unique index user_1_reviewer_1 and retrying attempt creation');
      try {
        await Attempt.collection.dropIndex('user_1_reviewer_1');
      } catch (dropErr) {
        if (dropErr.codeName !== 'IndexNotFound') throw dropErr;
      }
      return await Attempt.create(data);
    }

    // ── Fallback 2: race on in-progress guard index ───────────────────────────
    // A concurrent request beat us to creating the in-progress attempt.
    // Match by keyPattern instead of index name so it's resilient to name changes.
    const keyPattern = err.keyPattern || {};
    const isInProgressRace =
      keyPattern.user === 1 &&
      keyPattern.reviewer === 1 &&
      !keyPattern.status; // the partial index only covers {user, reviewer}

    if (isInProgressRace) {
      const existing = await Attempt.findOne({
        user: data.user,
        reviewer: data.reviewer,
        status: 'in_progress',
      });
      if (existing) return existing;
    }

    throw err;
  }
}

/**
 * Assemble questions dynamically based on exam config.
 * Non-general-info sections prefer questions that have a topic assigned;
 * falls back to the full section pool if the filtered pool is too small.
 */
async function assembleDynamic(cfg) {
  const allSelected = [];

  for (const sd of cfg.sectionDistribution) {
    const isGeneralInfo =
      sd.section === "general information" || sd.section === "general_info";

    const baseFilter = {
      status: "approved",
      examFamily: cfg.examFamily,
      examLevel: { $in: cfg.examLevel },
      section: sd.section,
    };

    // For non-general-info sections, prefer questions with a topic assigned.
    let pool = await Question.find(
      isGeneralInfo
        ? baseFilter
        : { ...baseFilter, topic: { $exists: true, $ne: "" } }
    );

    // Fallback: if the topic-filtered pool is too small, use the full section pool.
    if (!isGeneralInfo && pool.length < sd.count) {
      pool = await Question.find(baseFilter);
    }

    const selected = selectWithTopicAndDifficulty(
      pool,
      sd.count,
      cfg.difficultyDistribution
    );

    allSelected.push(...selected);
  }

  // Shuffle the final set (inter-section)
  shuffle(allSelected);

  return allSelected;
}

/**
 * Format attempt for client (strip correct answers during exam).
 */
function formatAttemptForClient(attempt) {
  const questions = attempt.questions.map((q, idx) => ({
    _id: q._id,
    index: idx,
    questionText: q.questionText,
    choiceA: q.choiceA,
    choiceB: q.choiceB,
    choiceC: q.choiceC,
    choiceD: q.choiceD,
    section: q.section,
    topic: q.topic,
    // DO NOT send correctAnswer, explanations – those come after submission
  }));

  // Compute live remaining time on resume:
  // - If tickedAt is set, the client previously confirmed the timer was running.
  //   Subtract elapsed time since that last sync to reflect refreshes/closes.
  // - If tickedAt is null but the attempt has no synced remaining yet (fresh attempt
  //   that the user opened then immediately refreshed), fall back to startedAt math.
  // - Otherwise (post-pause), trust the stored value.
  let liveRemaining = attempt.remainingSeconds;
  if (attempt.status === "in_progress" && Number.isFinite(attempt.remainingSeconds)) {
    if (attempt.tickedAt) {
      const elapsed = Math.floor((Date.now() - new Date(attempt.tickedAt).getTime()) / 1000);
      liveRemaining = Math.max(0, attempt.remainingSeconds - Math.max(0, elapsed));
    } else if (attempt.startedAt && !attempt.answers.some((a) => a.selectedAnswer)) {
      // No tickedAt + no answers saved → still the initial server-set value. Use wall clock.
      const elapsed = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
      liveRemaining = Math.max(0, attempt.remainingSeconds - Math.max(0, elapsed));
    }
  }

  return {
    attemptId: attempt._id,
    reviewerId: attempt.reviewer,
    status: attempt.status,
    currentIndex: attempt.currentIndex,
    startedAt: attempt.startedAt,
    remainingSeconds: liveRemaining,
    totalQuestions: questions.length,
    questions,
    // Which questions user has answered + their answers
    answeredIndices: attempt.answers
      .map((a, i) => (a.selectedAnswer ? i : null))
      .filter((i) => i !== null),
    // Map of question index to selected answer (for resuming)
    userAnswers: attempt.answers.reduce((map, a, i) => {
      if (a.selectedAnswer) {
        map[i] = a.selectedAnswer;
      }
      return map;
    }, {}),
  };
}

// ─── Save answer / update progress ──────────────

/**
 * PUT /api/exams/attempts/:attemptId/answer
 * Body: { questionIndex, selectedAnswer }
 */
exports.saveAnswer = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { questionIndex, selectedAnswer, remainingSeconds } = req.body;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in_progress",
    });

    if (!attempt) {
      return res
        .status(404)
        .json({ success: false, message: "Attempt not found or already submitted" });
    }

    if (questionIndex < 0 || questionIndex >= attempt.answers.length) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid question index" });
    }

    attempt.answers[questionIndex].selectedAnswer = selectedAnswer || null;
    attempt.currentIndex = questionIndex;
    attempt.markModified("answers");
    if (Number.isFinite(remainingSeconds)) {
      attempt.remainingSeconds = Math.max(0, Math.round(remainingSeconds));
      attempt.tickedAt = new Date();
    }
    await attempt.save();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/exams/attempts/:attemptId/beacon
 * No protect middleware — token is in body (sendBeacon cannot set headers).
 * Body: { token, answers: { [questionIndex]: selectedAnswer } }
 */
exports.beaconSave = async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const userId = decoded.id;
    const { attemptId } = req.params;
    const answersMap = req.body?.answers || {};
    const remainingSeconds = req.body?.remainingSeconds;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: userId,
      status: "in_progress",
    });

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Attempt not found or already submitted" });
    }

    for (const [questionIndexStr, selectedAnswer] of Object.entries(answersMap)) {
      const questionIndex = parseInt(questionIndexStr, 10);
      if (Number.isNaN(questionIndex) || questionIndex < 0 || questionIndex >= attempt.answers.length) continue;
      attempt.answers[questionIndex].selectedAnswer = selectedAnswer || null;
    }
    attempt.markModified("answers");
    if (Number.isFinite(remainingSeconds)) {
      attempt.remainingSeconds = Math.max(0, Math.round(remainingSeconds));
      attempt.tickedAt = new Date();
    }
    await attempt.save();

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "beaconSave error");
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * PUT /api/exams/attempts/:attemptId/pause
 * Body: { remainingSeconds, currentIndex }
 */
exports.pauseExam = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { remainingSeconds, currentIndex } = req.body;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in_progress",
    });

    if (!attempt) {
      return res
        .status(404)
        .json({ success: false, message: "Attempt not found" });
    }

    if (remainingSeconds !== undefined) attempt.remainingSeconds = remainingSeconds;
    if (currentIndex !== undefined) attempt.currentIndex = currentIndex;
    // Paused — timer is no longer "live"; clear tickedAt so resume doesn't subtract elapsed time.
    attempt.tickedAt = null;
    await attempt.save();

    res.json({ success: true, message: "Exam paused" });
  } catch (err) {
    next(err);
  }
};

// ─── Submit exam ────────────────────────────────

/**
 * POST /api/exams/attempts/:attemptId/submit
 * Computes score, section breakdown, pass/fail.
 */
exports.submitExam = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const submittedRemainingSeconds = req.body?.remainingSeconds;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in_progress",
    }).populate("questions reviewer");

    if (!attempt) {
      return res
        .status(404)
        .json({ success: false, message: "Attempt not found or already submitted" });
    }

    console.log("[EXAM SUBMIT] attempt submit started", {
      attemptId: attempt._id?.toString(),
      userId: req.user._id?.toString(),
    });

    // Grade each answer
    const questions = attempt.questions;
    let totalCorrect = 0;
    let totalIncorrect = 0;
    let totalUnanswered = 0;
    const sectionMap = {};

    questions.forEach((q, idx) => {
      const answer = attempt.answers[idx];
      if (!answer.selectedAnswer) {
        answer.isCorrect = false;
        totalUnanswered++;
      } else if (answer.selectedAnswer === q.correctAnswer) {
        answer.isCorrect = true;
        totalCorrect++;
      } else {
        answer.isCorrect = false;
        totalIncorrect++;
      }

      // Section scores
      const sec = q.section || "other";
      if (!sectionMap[sec]) {
        sectionMap[sec] = { section: sec, totalItems: 0, correct: 0, incorrect: 0, unanswered: 0 };
      }
      sectionMap[sec].totalItems++;
      if (!answer.selectedAnswer) sectionMap[sec].unanswered++;
      else if (answer.isCorrect) sectionMap[sec].correct++;
      else sectionMap[sec].incorrect++;
    });

    const sectionScores = Object.values(sectionMap).map((s) => ({
      ...s,
      score: s.totalItems ? parseFloat(((s.correct / s.totalItems) * 100).toFixed(2)) : 0,
    }));

    // Sort section scores for strengths/improvements
    const sorted = [...sectionScores].sort((a, b) => b.score - a.score);
    const strengths = sorted.slice(0, 3).map((s) => s.section);
    const improvements = sorted
      .filter((s) => s.score < 80)
      .slice(0, 4)
      .map((s) => s.section);

    const totalItems = questions.length;
    const percentage = totalItems
      ? parseFloat(((totalCorrect / totalItems) * 100).toFixed(2))
      : 0;

    const passingThreshold = attempt.reviewer?.examConfig?.passingThreshold || null;
    const passingScore = passingThreshold
      ? Math.ceil((passingThreshold / 100) * totalItems)
      : null;
    const passed = passingThreshold ? percentage >= passingThreshold : null;

    attempt.status = "submitted";
    attempt.submittedAt = new Date();

    if (Number.isFinite(submittedRemainingSeconds)) {
      attempt.remainingSeconds = Math.max(0, Math.round(submittedRemainingSeconds));
    }

    const timeLimitSeconds = attempt.reviewer?.examConfig?.timeLimitSeconds;
    const hasTimeLimit = Number.isFinite(timeLimitSeconds) && timeLimitSeconds > 0;

    let durationSeconds = null;
    if (hasTimeLimit) {
      const remaining = Number.isFinite(attempt.remainingSeconds)
        ? Math.min(timeLimitSeconds, Math.max(0, Math.round(attempt.remainingSeconds)))
        : timeLimitSeconds;
      durationSeconds = Math.max(0, Math.round(timeLimitSeconds - remaining));
    } else if (attempt.startedAt) {
      durationSeconds = Math.round((attempt.submittedAt - new Date(attempt.startedAt)) / 1000);
    }

    // Determine exam type from reviewer
    const examType = attempt.reviewer?.type || "mock"; // mock | practice | demo

    // Compute performance level for practice exams
    let performanceLevel = null;
    if (examType === "practice") {
      if (percentage >= 85) performanceLevel = "Strong";
      else if (percentage >= 70) performanceLevel = "Developing";
      else performanceLevel = "Needs Improvement";
    }

    attempt.result = {
      totalItems,
      correct: totalCorrect,
      incorrect: totalIncorrect,
      unanswered: totalUnanswered,
      percentage,
      passed,
      passingScore,
      sectionScores,
      strengths,
      improvements,
      performanceLevel,
      duration: durationSeconds,
    };

    // Generate recommended next steps (backend-driven)
    try {
      const allReviewers = await Reviewer.find({
        status: "published",
        type: { $in: ["practice", "mock"] },
      })
        .select("title type logo details examConfig access")
        .lean();
      const rec = generateRecommendations({
        examType,
        result: attempt.result,
        currentReviewer: attempt.reviewer,
        allReviewers,
      });
      attempt.result.recommendedNextStep = rec;
    } catch (err) {
      logger.error({ err }, "Recommendations generation failed");
    }

    attempt.markModified("answers");

    const updated = await Attempt.findOneAndUpdate(
      { _id: attemptId, user: req.user._id, status: "in_progress" },
      {
        $set: {
          status: "submitted",
          submittedAt: attempt.submittedAt,
          result: attempt.result,
          answers: attempt.answers,
        },
      },
      { new: true }
    );

    if (!updated) {
      const existing = await Attempt.findById(attemptId).lean();
      const existingResult = existing?.result || attempt.result;
      let resultToSend = existingResult;
      if (existingResult?.recommendedNextStep?.ctas?.length) {
        const populatedCtas = await populateRecommendationReviewers(
          existingResult.recommendedNextStep.ctas,
          Reviewer
        );
        resultToSend = {
          ...existingResult,
          recommendedNextStep: { ...existingResult.recommendedNextStep, ctas: populatedCtas },
        };
      }
      return res.json({
        success: true,
        data: {
          attemptId: existing?._id || attemptId,
          result: resultToSend,
        },
      });
    }

    const rawResult = updated.result;
    const plainResult = typeof rawResult?.toObject === "function" ? rawResult.toObject() : rawResult;
    let resultToSend = plainResult;
    if (plainResult?.recommendedNextStep?.ctas?.length) {
      const populatedCtas = await populateRecommendationReviewers(
        plainResult.recommendedNextStep.ctas,
        Reviewer
      );
      resultToSend = {
        ...plainResult,
        recommendedNextStep: { ...plainResult.recommendedNextStep, ctas: populatedCtas },
      };
    }
    console.log("[EXAM SUBMIT] result saved to DB", {
      attemptId: updated._id?.toString(),
      userId: req.user._id?.toString(),
    });
    res.json({
      success: true,
      data: {
        attemptId: updated._id,
        result: resultToSend,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get attempt results (for review) ───────────

/**
 * GET /api/exams/attempts/:attemptId/review
 * Returns full attempt with correct answers and explanations.
 */
exports.getAttemptReview = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: { $in: ["submitted", "timed_out"] },
    }).populate("questions reviewer");

    if (!attempt) {
      return res
        .status(404)
        .json({ success: false, message: "Attempt not found or still in progress" });
    }

    const questions = attempt.questions.map((q, idx) => ({
      _id: q._id,
      index: idx,
      questionText: q.questionText,
      choiceA: q.choiceA,
      choiceB: q.choiceB,
      choiceC: q.choiceC,
      choiceD: q.choiceD,
      correctAnswer: q.correctAnswer,
      explanationCorrect: q.explanationCorrect,
      explanationWrong: q.explanationWrong,
      reviewlyTip: q.reviewlyTip,
      section: q.section,
      module: q.module,
      topic: q.topic,
      selectedAnswer: attempt.answers[idx]?.selectedAnswer || null,
      isCorrect: attempt.answers[idx]?.isCorrect || false,
    }));

    res.json({
      success: true,
      data: {
        attemptId: attempt._id,
        reviewer: {
          _id: attempt.reviewer._id,
          title: attempt.reviewer.title,
          slug: attempt.reviewer.slug,
          type: attempt.reviewer.type,
        },
        result: attempt.result,
        questions,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/attempts/:attemptId
 * Returns attempt result summary (for results loading page).
 */
exports.getAttemptResult = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
    })
      .populate("reviewer", "title slug type examConfig logo details")
      .select("-questions")
      .lean();

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Attempt not found" });
    }

    // Backward compatibility: generate recommendations on-the-fly if missing
    if (attempt.result && !attempt.result.recommendedNextStep?.ctas?.length) {
      try {
        const allReviewers = await Reviewer.find({
          status: "published",
          type: { $in: ["practice", "mock"] },
        })
          .select("title type logo details examConfig access")
          .lean();
        const rec = generateRecommendations({
          examType: attempt.reviewer?.type || "mock",
          result: attempt.result,
          currentReviewer: attempt.reviewer,
          allReviewers,
        });
        if (!attempt.result.recommendedNextStep) {
          attempt.result.recommendedNextStep = {};
        }
        attempt.result.recommendedNextStep.ctas = rec.ctas;
      } catch (err) {
        logger.error({ err }, "Recommendations fallback failed");
      }
    }

    // Populate reviewer data for CTAs (fetched by reviewerId at read time)
    if (attempt.result?.recommendedNextStep?.ctas?.length) {
      attempt.result.recommendedNextStep.ctas = await populateRecommendationReviewers(
        attempt.result.recommendedNextStep.ctas,
        Reviewer
      );
    }

    const status = attempt.status === "submitted" || attempt.status === "timed_out" ? "completed" : "processing";
    const progressStage = status === "completed" ? "completed" : "scoring";

    res.json({ success: true, status, progressStage, data: attempt });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/attempts/user/history
 * Returns past attempts for the current user (paginated).
 */
exports.getUserAttempts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = { user: req.user._id, status: { $ne: 'in_progress' } };

    const [attempts, total] = await Promise.all([
      Attempt.find(filter)
        .populate("reviewer", "title slug type")
        .select(
          "reviewer status result.percentage result.passed result.correct result.totalItems result.duration createdAt submittedAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Attempt.countDocuments(filter),
    ]);

    const withProgress = attempts.map((a) => {
      // Format duration as "1hr 27m" or "35m"
      const durationSecs = a.result?.duration;
      if (durationSecs != null && durationSecs > 0) {
        const totalMins = Math.round(durationSecs / 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        a.timeTaken = hrs > 0 ? `${hrs}hr${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
      } else {
        a.timeTaken = null;
      }
      // Strip heavy arrays from response
      delete a.answers;
      delete a.questions;
      return a;
    });

    res.json({
      success: true,
      data: withProgress,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/attempts/user/progress/:reviewerId
 * Returns aggregated progress for a specific reviewer:
 *   - latest in-progress attempt (if any)
 *   - all completed attempts with scores
 *   - best score, average score
 */
exports.getReviewerProgress = async (req, res, next) => {
  try {
    const { reviewerId } = req.params;

    const attempts = await Attempt.find({
      user: req.user._id,
      reviewer: reviewerId,
    })
      .select(
        "status currentIndex answers questions result.percentage result.passed result.correct result.totalItems result.duration createdAt submittedAt remainingSeconds"
      )
      .sort({ createdAt: -1 })
      .lean();

    // In-progress attempt
    const inProgress = attempts.find((a) => a.status === "in_progress") || null;

    // Completed attempts
    const completed = attempts.filter(
      (a) => a.status === "submitted" || a.status === "timed_out"
    );

    // Stats
    const totalAttempts = completed.length;
    const bestScore =
      totalAttempts > 0
        ? Math.max(...completed.map((a) => a.result?.percentage || 0))
        : null;
    const avgScore =
      totalAttempts > 0
        ? Math.round(
          completed.reduce((sum, a) => sum + (a.result?.percentage || 0), 0) /
          totalAttempts
        )
        : null;
    const passCount = completed.filter((a) => a.result?.passed).length;

    // Build in-progress summary
    let inProgressSummary = null;
    if (inProgress) {
      const totalQuestions = inProgress.questions?.length || 0;
      const answeredCount = inProgress.answers
        ? inProgress.answers.filter((a) => a.selectedAnswer != null).length
        : 0;
      inProgressSummary = {
        attemptId: inProgress._id,
        currentIndex: inProgress.currentIndex || 0,
        totalQuestions,
        answeredCount,
        progressPercent:
          totalQuestions > 0
            ? Math.round((answeredCount / totalQuestions) * 100)
            : 0,
        remainingSeconds: inProgress.remainingSeconds,
        startedAt: inProgress.createdAt,
      };
    }

    res.json({
      success: true,
      data: {
        inProgress: inProgressSummary,
        totalAttempts,
        bestScore,
        avgScore,
        passCount,
        history: completed.map((a) => {
          const durationSecs = a.result?.duration;
          let timeTaken = null;
          if (durationSecs != null && durationSecs > 0) {
            const totalMins = Math.round(durationSecs / 60);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            timeTaken = hrs > 0 ? `${hrs}hr${mins > 0 ? ` ${mins}m` : ""}` : `${mins}m`;
          }
          return {
            _id: a._id,
            status: a.status,
            result: {
              percentage: a.result?.percentage || 0,
              passed: a.result?.passed || false,
              correct: a.result?.correct || 0,
              totalItems: a.result?.totalItems || 0,
            },
            timeTaken,
            submittedAt: a.submittedAt,
            createdAt: a.createdAt,
          };
        }),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Share ─────────────────────────────────────────────────────────

/**
 * POST /api/exams/attempts/:attemptId/share
 * Generate (or return existing) share token for an attempt.
 */
const getFrontendOriginFromRequest = (req) => {
  const configuredOrigins = (process.env.DOMAIN_FRONTEND || `${req.protocol}://${req.get('host')}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const originHeader = String(req.get('origin') || '').trim();
  if (originHeader && configuredOrigins.includes(originHeader)) {
    return originHeader;
  }

  const referer = String(req.get('referer') || '').trim();
  if (referer) {
    try {
      const url = new URL(referer);
      if (configuredOrigins.includes(url.origin)) {
        return url.origin;
      }
    } catch (err) {
      // ignore invalid referer
    }
  }

  return configuredOrigins[0] || `${req.protocol}://${req.get('host')}`;
};

exports.generateShareLink = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: { $in: ["submitted", "timed_out"] },
    });

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Attempt not found" });
    }

    if (!attempt.shareToken) {
      attempt.shareToken = crypto.randomBytes(16).toString("hex");
      await attempt.save();
    }

    const frontendOrigin = getFrontendOriginFromRequest(req);
    const shareUrl = `${frontendOrigin}/share/${attempt.shareToken}`;

    res.json({ success: true, shareToken: attempt.shareToken, shareUrl });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/shared/:shareToken
 * Public endpoint — no auth required.
 * Returns a limited view of the attempt result for sharing.
 */
exports.getSharedResult = async (req, res, next) => {
  try {
    const { shareToken } = req.params;

    if (!shareToken || shareToken.length !== 32) {
      return res.status(400).json({ success: false, message: "Invalid share token" });
    }

    const attempt = await Attempt.findOne({ shareToken })
      .populate("reviewer", "title type examConfig")
      .select("reviewer result submittedAt shareToken shareImageUrl")
      .lean();

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Shared result not found" });
    }

    // Strip AI/internal fields – return only what the public card needs
    const { sectionScores, percentage, passed, correct, totalItems, duration, passingScore } =
      attempt.result || {};

    res.json({
      success: true,
      data: {
        reviewer: attempt.reviewer,
        submittedAt: attempt.submittedAt,
        shareImageUrl: attempt.shareImageUrl || null,
        result: { sectionScores, percentage, passed, correct, totalItems, duration, passingScore },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/exams/attempts/:attemptId/share-image
 * Protected. Receives a JPEG data URL and stores it as the OG preview image for this attempt.
 */
exports.uploadShareImage = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { imageData } = req.body;

    if (!imageData || typeof imageData !== "string") {
      return res.status(400).json({ success: false, message: "No image data provided" });
    }

    // Accept JPEG or PNG data URLs
    const match = imageData.match(/^data:image\/(jpeg|png);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: "Invalid image format. Expected JPEG or PNG data URL." });
    }

    const buffer = Buffer.from(match[2], "base64");

    // Reject unreasonably large images (>3 MB buffer)
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Image too large (max 3 MB)" });
    }

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: { $in: ["submitted", "timed_out"] },
    });

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Attempt not found" });
    }

    const uploadResult = await cloudinary.uploader.upload(imageData, {
      folder: "reviewly/share_images",
      public_id: `share_${attempt._id.toString()}`,
      overwrite: true,
      resource_type: "image",
      quality: "auto:low",
      fetch_format: "auto",
    });

    attempt.shareImageUrl = uploadResult.secure_url;
    await attempt.save();

    res.json({ success: true, url: uploadResult.secure_url });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/shared/:shareToken/image
 * Public. Serves the stored score-card image for OG link previews.
 * Falls back to the static branded image if none has been uploaded yet.
 */
exports.getShareImage = async (req, res, next) => {
  try {
    const { shareToken } = req.params;

    if (!shareToken || shareToken.length !== 32) {
      return res.status(400).send("Invalid token");
    }

    const attempt = await Attempt.findOne({ shareToken }).select("shareImage shareImageUrl").lean();

    if (attempt?.shareImageUrl) {
      return res.redirect(attempt.shareImageUrl);
    }

    if (attempt?.shareImage) {
      const buf = Buffer.isBuffer(attempt.shareImage)
        ? attempt.shareImage
        : Buffer.from(attempt.shareImage.buffer || attempt.shareImage);

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Content-Length", buf.length);
      return res.send(buf);
    }

    // No custom image yet — redirect to static branded fallback
    const frontendOrigin = getFrontendOriginFromRequest(req);
    return res.redirect(`${frontendOrigin}/og-share.png`);
  } catch (err) {
    next(err);
  }
};
