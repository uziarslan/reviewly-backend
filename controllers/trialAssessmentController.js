const logger = require("../utils/logger");
const Reviewer = require("../models/Reviewer");
const Question = require("../models/Question");
const Attempt = require("../models/Attempt");
const User = require("../models/User");

// ─── helpers (shared with examController) ────────

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

  // If still short, fill from full pool.
  if (selected.length < count) {
    const selectedIds = new Set(selected.map((q) => q._id.toString()));
    const remaining = pool.filter((q) => !selectedIds.has(q._id.toString()));
    shuffle(remaining);
    selected.push(...remaining.slice(0, count - selected.length));
  }

  return selected.slice(0, count);
}

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

  shuffle(allSelected);
  return allSelected;
}

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
  }));

  return {
    attemptId: attempt._id,
    reviewerId: attempt.reviewer._id || attempt.reviewer,
    status: attempt.status,
    currentIndex: attempt.currentIndex,
    startedAt: attempt.startedAt,
    remainingSeconds: attempt.remainingSeconds,
    totalQuestions: questions.length,
    questions,
    answeredIndices: attempt.answers
      .map((a, i) => (a.selectedAnswer ? i : null))
      .filter((i) => i !== null),
    userAnswers: attempt.answers.reduce((map, a, i) => {
      if (a.selectedAnswer) map[i] = a.selectedAnswer;
      return map;
    }, {}),
  };
}

// ─── GET /api/trial-assessment/status ────────────
// Returns whether the user needs to take the trial assessment.

exports.getTrialStatus = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        trialCompleted: req.user.trialAssessment === true,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trial-assessment/reviewers ─────────
// Returns the two trial assessment reviewers (professional & sub-professional).

exports.getTrialReviewers = async (req, res, next) => {
  try {
    const reviewers = await Reviewer.find({
      type: "trial_assessment",
      status: "published",
    })
      .sort({ order: 1 })
      .lean();

    res.json({ success: true, data: reviewers });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trial-assessment/skip ─────────────
// User skips the trial assessment. Mark as done.

exports.skipTrial = async (req, res, next) => {
  try {
    const { examType } = req.body || {};
    if (examType !== "professional" && examType !== "subprofessional") {
      // examType is required at skip time — without it the user would land on
      // an inconsistent dashboard (no track chosen) and immediately get
      // bounced back here. Force them to pick before we mark the trial as
      // done.
      return res.status(400).json({
        success: false,
        message: "Pick a Civil Service Exam track before skipping the trial",
      });
    }

    await User.findByIdAndUpdate(req.user._id, {
      $set: { trialAssessment: true, examType },
    });

    res.json({ success: true, message: "Trial assessment skipped" });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trial-assessment/:reviewerId/start ─
// Start the trial assessment exam.

exports.startTrialExam = async (req, res, next) => {
  try {
    const isRetake = req.body?.retake === true;

    const reviewer = await Reviewer.findOne({
      _id: req.params.reviewerId,
      type: "trial_assessment",
      status: "published",
    });

    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Trial assessment not found" });
    }

    const cfg = reviewer.examConfig;

    // Persist the user's exam-type preference so the dashboard, sprint, and
    // mock recommendations stay aligned with what they picked at onboarding.
    // Prefers an explicit body param, then falls back to the reviewer's slug
    // (the trial reviewers map 1:1 to a single track).
    const explicitType = req.body?.examType;
    let derivedType = null;
    if (explicitType === "professional" || explicitType === "subprofessional") {
      derivedType = explicitType;
    } else if (typeof reviewer.slug === "string") {
      if (reviewer.slug.includes("subprofessional")) derivedType = "subprofessional";
      else if (reviewer.slug.includes("professional")) derivedType = "professional";
    }
    if (derivedType) {
      await User.findByIdAndUpdate(req.user._id, { $set: { examType: derivedType } });
    }

    // Check for existing attempt — must come BEFORE the trialAssessment guard
    // so users with `trialAssessment: true` can still resume an in-progress
    // retake. (Exam.js calls start() on mount without the retake flag to load
    // the attempt; that load must succeed even though the flag is set.)
    let attempt = await Attempt.findOne({
      user: req.user._id,
      reviewer: reviewer._id,
    });

    // Resume in-progress attempt regardless of user.trialAssessment flag.
    if (attempt && attempt.status === "in_progress" && !isRetake) {
      await attempt.populate("questions");
      return res.json({
        success: true,
        message: "Resuming trial assessment",
        data: formatAttemptForClient(attempt),
      });
    }

    // Block fresh starts (no in-progress attempt) when the user has already
    // completed/skipped the trial — unless they explicitly opt in to a retake.
    if (req.user.trialAssessment === true && !isRetake) {
      return res.status(400).json({
        success: false,
        message: "Trial assessment already completed",
      });
    }

    // If already submitted, they've done it
    if (
      attempt &&
      (attempt.status === "submitted" || attempt.status === "timed_out") &&
      !isRetake
    ) {
      await User.findByIdAndUpdate(req.user._id, {
        $set: { trialAssessment: true },
      });
      return res.status(400).json({
        success: false,
        message: "Trial assessment already completed",
      });
    }

    if (attempt && isRetake) {
      await Attempt.deleteOne({ _id: attempt._id });
      attempt = null;
    }

    // Assemble new questions
    const selected = await assembleDynamic(cfg);
    const questionIds = selected.map((q) => q._id);

    const answersArray = questionIds.map((qId) => ({
      question: qId,
      selectedAnswer: null,
      isCorrect: false,
    }));

    const attemptData = {
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

    try {
      attempt = await Attempt.create(attemptData);
    } catch (err) {
      if (err.code === 11000) {
        attempt = await Attempt.findOne({
          user: req.user._id,
          reviewer: reviewer._id,
        }).populate("questions");
        if (attempt) {
          return res.json({
            success: true,
            message: "Resuming trial assessment",
            data: formatAttemptForClient(attempt),
          });
        }
      }
      throw err;
    }

    await attempt.populate("questions");

    res.status(201).json({
      success: true,
      data: formatAttemptForClient(attempt),
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trial-assessment/:attemptId/submit ─
// Submit the trial assessment and mark user as done.

exports.submitTrialExam = async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const submittedRemainingSeconds = req.body?.remainingSeconds;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in_progress",
    }).populate("questions reviewer");

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found or already submitted",
      });
    }

    // Verify this is a trial assessment
    if (attempt.reviewer?.type !== "trial_assessment") {
      return res.status(400).json({
        success: false,
        message: "This endpoint is only for trial assessments",
      });
    }

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

    const sorted = [...sectionScores].sort((a, b) => b.score - a.score);
    const strengths = sorted.slice(0, 3).map((s) => s.section);
    const improvements = sorted.filter((s) => s.score < 80).slice(0, 4).map((s) => s.section);

    const totalItems = questions.length;
    const percentage = totalItems
      ? parseFloat(((totalCorrect / totalItems) * 100).toFixed(2))
      : 0;

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
      durationSeconds = Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
    }

    // Determine performance level
    let performanceLevel = null;
    if (percentage >= 85) performanceLevel = "Strong";
    else if (percentage >= 70) performanceLevel = "Developing";
    else performanceLevel = "Needs Improvement";

    const now = new Date();

    const updated = await Attempt.findOneAndUpdate(
      { _id: attemptId, user: req.user._id, status: "in_progress" },
      {
        $set: {
          status: "submitted",
          submittedAt: now,
          answers: attempt.answers,
          result: {
            totalItems,
            correct: totalCorrect,
            incorrect: totalIncorrect,
            unanswered: totalUnanswered,
            percentage,
            passed: null,
            passingScore: null,
            sectionScores,
            strengths,
            improvements,
            performanceLevel,
            duration: durationSeconds,
          },
        },
      },
      { new: true }
    );

    // Mark trial assessment as completed
    await User.findByIdAndUpdate(req.user._id, {
      $set: { trialAssessment: true },
    });

    res.json({
      success: true,
      data: {
        attemptId: updated?._id || attemptId,
        result: updated?.result || {
          totalItems,
          correct: totalCorrect,
          incorrect: totalIncorrect,
          unanswered: totalUnanswered,
          percentage,
          sectionScores,
          strengths,
          improvements,
          performanceLevel,
          duration: durationSeconds,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trial-assessment/:attemptId/abandon ─
// User abandons an in-progress trial assessment.

exports.abandonTrialExam = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: "in_progress",
    }).populate("reviewer");

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found or already submitted",
      });
    }

    if (attempt.reviewer?.type !== "trial_assessment") {
      return res.status(400).json({
        success: false,
        message: "This endpoint is only for trial assessments",
      });
    }

    // Mark attempt as timed_out (abandoned)
    await Attempt.findByIdAndUpdate(attemptId, {
      $set: { status: "timed_out", submittedAt: new Date() },
    });

    // Mark trial as done so user won't see it again
    await User.findByIdAndUpdate(req.user._id, {
      $set: { trialAssessment: true },
    });

    res.json({ success: true, message: "Trial assessment abandoned" });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trial-assessment/:attemptId/result ──
// Get trial assessment result (after submission).

exports.getTrialResult = async (req, res, next) => {
  try {
    const { attemptId } = req.params;

    const attempt = await Attempt.findOne({
      _id: attemptId,
      user: req.user._id,
      status: { $in: ["submitted", "timed_out"] },
    })
      .populate("reviewer", "title slug type examConfig")
      .lean();

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Result not found",
      });
    }

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
      },
    });
  } catch (err) {
    next(err);
  }
};
