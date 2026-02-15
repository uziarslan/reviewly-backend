const Reviewer = require("../models/Reviewer");
const Question = require("../models/Question");
const Attempt = require("../models/Attempt");
const { generateGeminiAnalysis } = require("../utils/gemini");

// ─── helpers ──────────────────────────────────────

/** Shuffle array in place (Fisher-Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Select `count` questions from `pool` trying to match difficulty %.
 * diffDist = { easy: 30, medium: 50, hard: 20 }  (percentages)
 */
function selectWithDifficulty(pool, count, diffDist) {
  const easyTarget = Math.round((diffDist.easy / 100) * count);
  const hardTarget = Math.round((diffDist.hard / 100) * count);
  const medTarget = count - easyTarget - hardTarget;

  const buckets = { easy: [], medium: [], hard: [] };
  pool.forEach((q) => {
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

  // If any bucket was short, fill from others
  if (selected.length < count) {
    const usedIds = new Set(selected.map((q) => q._id.toString()));
    const remaining = pool.filter((q) => !usedIds.has(q._id.toString()));
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

    const cfg = reviewer.examConfig;
    if (!cfg) {
      return res
        .status(400)
        .json({ success: false, message: "Reviewer has no exam config" });
    }

    // ── Single-entry logic: one attempt per user + reviewer ──
    // Use findOne to check existing attempt
    let attempt = await Attempt.findOne({
      user: req.user._id,
      reviewer: reviewer._id,
    });

    // If in_progress, resume
    if (attempt && attempt.status === "in_progress") {
      await attempt.populate("questions");
      return res.json({
        success: true,
        message: "Resuming existing attempt",
        data: formatAttemptForClient(attempt),
      });
    }

    // Need new questions for first attempt or reattempt
    let questionIds = [];

    if (cfg.variant === "fixed") {
      // Fixed exams reuse the same questions
      if (attempt && attempt.questions.length > 0) {
        questionIds = attempt.questions;
      } else {
        const selected = await assembleDynamic(cfg);
        questionIds = selected.map((q) => q._id);
      }
    } else {
      // Dynamic: new questions each attempt
      const selected = await assembleDynamic(cfg);
      questionIds = selected.map((q) => q._id);
    }

    const answersArray = questionIds.map((qId) => ({
      question: qId,
      selectedAnswer: null,
      isCorrect: false,
    }));

    const resetData = {
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
        aiSummary: null,
      },
    };

    if (attempt) {
      // Reattempt: update existing record atomically
      attempt = await Attempt.findOneAndUpdate(
        { user: req.user._id, reviewer: reviewer._id },
        { $set: resetData },
        { new: true }
      ).populate("questions");

      if (!attempt) {
        return res.status(500).json({ success: false, message: "Failed to update attempt" });
      }

      return res.status(200).json({
        success: true,
        data: formatAttemptForClient(attempt),
      });
    }

    // First attempt: create new record with upsert to handle race conditions
    try {
      attempt = await Attempt.create({
        user: req.user._id,
        reviewer: reviewer._id,
        ...resetData,
      });
    } catch (err) {
      // Handle duplicate key error (race condition)
      if (err.code === 11000) {
        // Another request created it, fetch and return
        attempt = await Attempt.findOne({
          user: req.user._id,
          reviewer: reviewer._id,
        }).populate("questions");
        
        if (attempt) {
          return res.json({
            success: true,
            message: "Resuming existing attempt",
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

/**
 * Assemble questions dynamically based on exam config.
 */
async function assembleDynamic(cfg) {
  const allSelected = [];

  for (const sd of cfg.sectionDistribution) {
    const filter = {
      status: "approved",
      examFamily: cfg.examFamily,
      examLevel: { $in: cfg.examLevel },
      section: sd.section,
    };

    const pool = await Question.find(filter);

    const selected = selectWithDifficulty(
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
    // DO NOT send correctAnswer, explanations – those come after submission
  }));

  return {
    attemptId: attempt._id,
    reviewerId: attempt.reviewer,
    status: attempt.status,
    currentIndex: attempt.currentIndex,
    startedAt: attempt.startedAt,
    remainingSeconds: attempt.remainingSeconds,
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
    const { questionIndex, selectedAnswer } = req.body;

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
    await attempt.save();

    res.json({ success: true });
  } catch (err) {
    next(err);
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
    };

    // Optional AI analysis (Gemini free tier)
    try {
      const aiAnalysis = await generateGeminiAnalysis({
        totalItems,
        correct: totalCorrect,
        percentage,
        sectionScores,
      });
      if (aiAnalysis) {
        attempt.result.strengths = aiAnalysis.strengths;
        attempt.result.improvements = aiAnalysis.improvements;
        attempt.result.aiSummary = aiAnalysis.summary || null;
      }
    } catch (err) {
      // Keep fallback strengths/improvements
      console.error("Gemini analysis failed:", err.message || err);
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
      const existing = await Attempt.findById(attemptId);
      return res.json({
        success: true,
        data: {
          attemptId: existing?._id || attemptId,
          result: existing?.result || attempt.result,
        },
      });
    }

    res.json({
      success: true,
      data: {
        attemptId: updated._id,
        result: updated.result,
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
      .populate("reviewer", "title slug examConfig")
      .select("-questions");

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Attempt not found" });
    }

    res.json({ success: true, data: attempt });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exams/attempts/user/history
 * Returns all past attempts for the current user.
 */
exports.getUserAttempts = async (req, res, next) => {
  try {
    const attempts = await Attempt.find({ user: req.user._id })
      .populate("reviewer", "title slug type")
      .select(
        "reviewer status result.percentage result.passed result.correct result.totalItems currentIndex answers.selectedAnswer questions createdAt submittedAt remainingSeconds"
      )
      .sort({ createdAt: -1 })
      .lean();

    // Attach lightweight progress info for in-progress attempts
    const withProgress = attempts.map((a) => {
      const totalQuestions = a.questions?.length || 0;
      if (a.status === "in_progress") {
        const answeredCount = a.answers
          ? a.answers.filter((ans) => ans.selectedAnswer != null).length
          : 0;
        a.progress = {
          current: a.currentIndex || 0,
          answeredCount,
          totalQuestions,
          progressPercent:
            totalQuestions > 0
              ? Math.round((answeredCount / totalQuestions) * 100)
              : 0,
        };
      }
      // Strip heavy arrays from response
      delete a.answers;
      delete a.questions;
      return a;
    });

    res.json({ success: true, data: withProgress });
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
        "status currentIndex answers questions result.percentage result.passed result.correct result.totalItems createdAt submittedAt remainingSeconds"
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
        history: completed.map((a) => ({
          attemptId: a._id,
          percentage: a.result?.percentage || 0,
          passed: a.result?.passed || false,
          correct: a.result?.correct || 0,
          totalItems: a.result?.totalItems || 0,
          submittedAt: a.submittedAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};
