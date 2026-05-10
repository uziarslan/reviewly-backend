const SprintPlan = require("../models/SprintPlan");
const Question = require("../models/Question");
const Setting = require("../models/Setting");
const Attempt = require("../models/Attempt");
const Reviewer = require("../models/Reviewer");
const logger = require("../utils/logger");
const { isPremiumActive, publicPlanState } = require("../utils/premium");

const SETTING_KEY_CSE_EXAM_DATE = "cseExamDate";

/**
 * Resolve the exam date the Readiness Checker should use:
 *   1. user.examDate   (per-user override, if ever set)
 *   2. Setting{key:"cseExamDate"}.value  (global, set by admin)
 */
async function resolveExamDate(user) {
  if (user?.examDate) return user.examDate;
  try {
    const doc = await Setting.findOne({ key: SETTING_KEY_CSE_EXAM_DATE }).lean();
    return doc?.value || null;
  } catch (_err) {
    return null;
  }
}

const { getDashboardSourceBundle } = require("../services/dashboard/attemptSource");
const { buildReadinessPayload } = require("../services/dashboard/readiness");
const { buildSectionBreakdown } = require("../services/dashboard/sectionBreakdown");
const { buildRecommendedFocus } = require("../services/dashboard/recommendedFocus");
const { generateSprintPlan } = require("../services/dashboard/sprintEngine");
const { generatePracticeSet } = require("../services/dashboard/practiceSet");
const { prettySection, canonicalTopic } = require("../services/dashboard/examStructure");

/**
 * Trim a SprintPlan document to a client-safe shape (no question IDs/answers).
 */
function publicPlanShape(plan) {
  if (!plan) return null;
  const tasks = plan.tasks.map((t) => {
    const focusTag = (t.topics && t.topics.length > 0)
      ? t.topics.join(" + ")
      : prettySection(t.section);
    const meta = `${t.questionCount} questions • ~${t.estimatedMinutes} minutes • ${t.label}`;
    return {
      taskId: t.taskId,
      day: t.day,
      type: t.type,
      title: t.title,
      section: t.section,
      sectionLabel: prettySection(t.section),
      topics: t.topics || [],
      focusTag,
      questionCount: t.questionCount,
      estimatedMinutes: t.estimatedMinutes,
      label: t.label,
      meta,
      status: t.status,
      hasAttempt: !!(t.attempt && t.attempt.questionIds && t.attempt.questionIds.length > 0),
      result: t.attempt?.submittedAt
        ? {
          correct: t.attempt.result?.correct ?? 0,
          totalItems: t.attempt.result?.totalItems ?? t.questionCount,
          percentage: t.attempt.result?.percentage ?? 0,
        }
        : null,
    };
  });

  return {
    sprintId: plan._id,
    examLevel: plan.examLevel,
    sourceType: plan.sourceType,
    primarySection: plan.primarySection,
    primarySectionLabel: prettySection(plan.primarySection),
    secondarySection: plan.secondarySection,
    secondarySectionLabel: plan.secondarySection ? prettySection(plan.secondarySection) : null,
    completedTasks: plan.completedTasks,
    totalTasks: plan.totalTasks,
    progress: `${plan.completedTasks}/${plan.totalTasks}`,
    status: plan.status,
    tasks,
    nextTask: tasks.find((t) => t.status === "not_started" || t.status === "in_progress") || null,
  };
}

async function getActivePlan(userId, examLevel) {
  const filter = { user: userId, status: "active" };
  if (examLevel) filter.examLevel = examLevel;
  return SprintPlan.findOne(filter);
}

/**
 * Most recent plan for the user, optionally scoped to a specific exam level.
 * Passing examLevel ensures plans from a different track don't interfere with
 * generation gates or the dashboard display.
 */
async function getMostRecentPlan(userId, examLevel) {
  const filter = { user: userId };
  if (examLevel) filter.examLevel = examLevel;
  return SprintPlan.findOne(filter)
    .sort({ createdAt: -1 })
    .select("createdAt status examLevel")
    .lean();
}

/**
 * True when the user has submitted a full mock matching `examLevel` after
 * `since`. Used to gate sprint regeneration on a fresh re-assessment so
 * regenerating actually produces a different plan.
 */
async function hasMockSince(userId, examLevel, since) {
  if (!since) return false;
  const candidates = await Attempt.find({
    user: userId,
    status: { $in: ["submitted", "timed_out"] },
    submittedAt: { $gt: since },
  })
    .populate({ path: "reviewer", select: "type examConfig slug" })
    .select("reviewer submittedAt")
    .lean();

  return candidates.some((a) => {
    if (a.reviewer?.type !== "mock") return false;
    const levels = a.reviewer?.examConfig?.examLevel || [];
    if (levels.includes(examLevel)) return true;
    const slug = a.reviewer?.slug || "";
    if (examLevel === "subprofessional" && slug.includes("subprofessional")) return true;
    if (examLevel === "professional" && slug.includes("professional") && !slug.includes("subprofessional")) return true;
    return false;
  });
}

/**
 * Decide whether the dashboard should let the user regenerate a sprint plan.
 * Returns `{ canRegenerate, reason }`.
 *
 * Rules:
 *  - No prior plan ever → not applicable here (the "Generate" button handles it).
 *  - Active plan exists → blocked (user is mid-sprint).
 *  - Plan completed/abandoned but no fresh mock submitted since → blocked
 *    with reason "needs_new_mock". Forces the user to retake a mock first
 *    so the regenerated plan reflects new performance, not a duplicate.
 *  - Plan completed/abandoned AND a matching mock was submitted since → unlocked.
 */
async function evaluateRegenerateGate(userId, examLevel) {
  const recent = await getMostRecentPlan(userId, examLevel);
  if (!recent) return { canRegenerate: false, reason: "no_prior_plan" };
  if (recent.status === "active") {
    return { canRegenerate: false, reason: "active_plan_in_progress" };
  }
  const fresh = await hasMockSince(userId, examLevel, recent.createdAt);
  return fresh
    ? { canRegenerate: true, reason: "ready" }
    : { canRegenerate: false, reason: "needs_new_mock" };
}

/**
 * Latest plan to surface on the dashboard, scoped to the user's current exam
 * level. Prefers the active plan, falling back to the most recently completed
 * plan so State E keeps rendering until the user explicitly regenerates.
 * Scoping by examLevel prevents plans from a previous track from appearing
 * after an exam-type switch.
 */
async function getDisplayPlan(userId, examLevel) {
  const filter = { user: userId };
  if (examLevel) filter.examLevel = examLevel;
  const active = await SprintPlan.findOne({ ...filter, status: "active" });
  if (active) return active;
  return SprintPlan.findOne({ ...filter, status: "completed" })
    .sort({ updatedAt: -1, createdAt: -1 });
}

// ─── GET /api/dashboard ─────────────────────────────

exports.getDashboard = async (req, res, next) => {
  try {
    const bundle = await getDashboardSourceBundle(req.user._id);
    const examDate = await resolveExamDate(req.user);
    const readiness = buildReadinessPayload(bundle, examDate);
    const sectionBreakdown = buildSectionBreakdown(bundle);
    const recommendedFocus = buildRecommendedFocus(bundle);

    const plan = await getDisplayPlan(req.user._id, bundle.level);
    const regenerate = await evaluateRegenerateGate(req.user._id, bundle.level);

    res.json({
      success: true,
      data: {
        examLevel: bundle.level,
        hasData: bundle.hasData,
        source: bundle.source,
        attemptCount: bundle.attempts.length,
        readiness,
        sectionBreakdown,
        recommendedFocus,
        sprintPlan: publicPlanShape(plan),
        sprintRegenerate: regenerate,
        plan: publicPlanState(req.user),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/dashboard/sprint/generate ──────────────

exports.generateSprint = async (req, res, next) => {
  try {
    const bundle = await getDashboardSourceBundle(req.user._id);
    if (!bundle.hasData) {
      return res.status(400).json({
        success: false,
        message: "Take an assessment or full mock first to generate a plan.",
      });
    }

    // Block duplicate active plans (scoped to current exam level).
    const existing = await getActivePlan(req.user._id, bundle.level);
    if (existing) {
      return res.json({
        success: true,
        message: "Active sprint plan already exists",
        data: { sprintPlan: publicPlanShape(existing) },
      });
    }

    // If the user has previously *completed* a plan, regeneration is gated on
    // having submitted a fresh full mock since that plan was created. Without
    // new performance data, the generator is deterministic and would produce
    // the same plan — so we lead the user back to a mock first.
    // Abandoned plans (e.g. from an exam-type switch) do NOT trigger this gate;
    // those are treated as a fresh start.
    const priorPlan = await getMostRecentPlan(req.user._id, bundle.level);
    if (priorPlan && priorPlan.status === "completed") {
      // Free users still hit the premium gate first.
      if (!isPremiumActive(req.user)) {
        return res.status(402).json({
          success: false,
          code: "premium_required",
          feature: "regenerate_sprint_after_completion",
          message: "Unlock Premium to regenerate a fresh 7-day plan.",
        });
      }
      const fresh = await hasMockSince(req.user._id, bundle.level, priorPlan.createdAt);
      if (!fresh) {
        return res.status(400).json({
          success: false,
          code: "needs_new_mock",
          message:
            "Take a full mock exam first to reassess your progress. Your next plan will reflect your new performance.",
        });
      }
    }

    const planData = generateSprintPlan(bundle);
    if (!planData) {
      return res.status(400).json({
        success: false,
        message: "Could not generate a plan from current data.",
      });
    }

    const plan = await SprintPlan.create({
      user: req.user._id,
      examFamily: "cse",
      ...planData,
      status: "active",
      completedTasks: 0,
      totalTasks: 7,
    });

    res.status(201).json({
      success: true,
      data: { sprintPlan: publicPlanShape(plan) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/dashboard/sprint ─────────────────────
// Abandon active plan (allows regeneration after a fresh attempt).

exports.abandonSprint = async (req, res, next) => {
  try {
    const plan = await getActivePlan(req.user._id);
    if (!plan) {
      return res.json({ success: true, message: "No active plan" });
    }
    plan.status = "abandoned";
    await plan.save();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/dashboard/sprint/tasks/:taskId/start ───
// Build a question set for the task, persist on the plan, return delivery payload.

exports.startSprintTask = async (req, res, next) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(402).json({
        success: false,
        code: "premium_required",
        feature: "start_sprint_task",
        message: "Unlock Premium to start sprint tasks.",
      });
    }

    const plan = await getActivePlan(req.user._id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "No active sprint plan" });
    }

    const task = plan.tasks.find((t) => t.taskId === req.params.taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found in plan" });
    }

    if (task.status === "completed") {
      return res.status(400).json({ success: false, message: "Task already completed" });
    }

    // If a question set already exists (in_progress), return it.
    let questions;
    if (task.attempt && task.attempt.questionIds && task.attempt.questionIds.length > 0) {
      questions = await Question.find({ _id: { $in: task.attempt.questionIds } }).lean();
      // Preserve the order persisted on the plan.
      const order = new Map(task.attempt.questionIds.map((id, i) => [String(id), i]));
      questions.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
    } else {
      const { questions: picked } = await generatePracticeSet({
        task,
        examLevel: plan.examLevel,
        plan,
      });
      questions = picked;
      task.attempt = {
        questionIds: picked.map((q) => q._id),
        answers: picked.map((q) => ({
          question: q._id,
          selectedAnswer: null,
          isCorrect: false,
        })),
        startedAt: new Date(),
        submittedAt: null,
        result: {
          totalItems: picked.length,
          correct: 0,
          incorrect: 0,
          unanswered: 0,
          percentage: 0,
        },
      };
      task.status = "in_progress";
      await plan.save();
    }

    const safeQuestions = questions.map((q, idx) => ({
      _id: q._id,
      index: idx,
      questionText: q.questionText,
      choiceA: q.choiceA,
      choiceB: q.choiceB,
      choiceC: q.choiceC,
      choiceD: q.choiceD,
      section: q.section,
      topic: canonicalTopic(q.topic),
    }));

    // Restore any answers the user already saved on this task (resume).
    const savedAnswers = {};
    (task.attempt?.answers || []).forEach((a, idx) => {
      if (a && a.selectedAnswer) savedAnswers[idx] = a.selectedAnswer;
    });

    res.json({
      success: true,
      data: {
        sprintId: plan._id,
        task: {
          taskId: task.taskId,
          title: task.title,
          type: task.type,
          section: task.section,
          sectionLabel: prettySection(task.section),
          topics: task.topics,
          questionCount: task.questionCount,
          estimatedMinutes: task.estimatedMinutes,
          label: task.label,
        },
        questions: safeQuestions,
        totalQuestions: safeQuestions.length,
        savedAnswers,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/dashboard/sprint/tasks/:taskId/submit ──

exports.submitSprintTask = async (req, res, next) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(402).json({
        success: false,
        code: "premium_required",
        feature: "start_sprint_task",
        message: "Unlock Premium to submit sprint tasks.",
      });
    }

    const { answers } = req.body || {};
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ success: false, message: "Missing answers" });
    }

    const plan = await getActivePlan(req.user._id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "No active sprint plan" });
    }

    const task = plan.tasks.find((t) => t.taskId === req.params.taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found in plan" });
    }

    if (!task.attempt || !task.attempt.questionIds || task.attempt.questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Task has not been started",
      });
    }

    if (task.status === "completed") {
      return res.status(400).json({ success: false, message: "Task already completed" });
    }

    const questions = await Question.find({
      _id: { $in: task.attempt.questionIds },
    }).lean();
    const qById = new Map(questions.map((q) => [String(q._id), q]));

    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;

    const gradedAnswers = task.attempt.questionIds.map((qid, idx) => {
      const q = qById.get(String(qid));
      const submitted = answers[idx] || answers[String(idx)] || null;
      const valid = ["A", "B", "C", "D"].includes(submitted) ? submitted : null;

      let isCorrect = false;
      if (!valid) {
        unanswered += 1;
      } else if (q && valid === q.correctAnswer) {
        isCorrect = true;
        correct += 1;
      } else {
        incorrect += 1;
      }

      return { question: qid, selectedAnswer: valid, isCorrect };
    });

    const totalItems = task.attempt.questionIds.length;
    const percentage = totalItems > 0 ? parseFloat(((correct / totalItems) * 100).toFixed(2)) : 0;

    task.attempt.answers = gradedAnswers;
    task.attempt.submittedAt = new Date();
    task.attempt.result = {
      totalItems,
      correct,
      incorrect,
      unanswered,
      percentage,
    };
    task.status = "completed";
    task.completedAt = new Date();

    plan.completedTasks = plan.tasks.filter((t) => t.status === "completed").length;
    if (plan.completedTasks >= plan.totalTasks) {
      plan.status = "completed";
    }

    await plan.save();

    // Build a review payload so the frontend can show answers + correct
    // answers + explanations without a second request.
    const review = task.attempt.questionIds.map((qid, idx) => {
      const q = qById.get(String(qid));
      const ans = gradedAnswers[idx];
      return {
        index: idx,
        questionId: qid,
        questionText: q?.questionText || "",
        choiceA: q?.choiceA || "",
        choiceB: q?.choiceB || "",
        choiceC: q?.choiceC || "",
        choiceD: q?.choiceD || "",
        section: q?.section || "",
        topic: canonicalTopic(q?.topic) || "",
        correctAnswer: q?.correctAnswer || null,
        explanationCorrect: q?.explanationCorrect || "",
        explanationWrong: q?.explanationWrong || "",
        reviewlyTip: q?.reviewlyTip || "",
        selectedAnswer: ans?.selectedAnswer || null,
        isCorrect: !!ans?.isCorrect,
      };
    });

    res.json({
      success: true,
      data: {
        taskId: task.taskId,
        result: task.attempt.result,
        sprintPlan: publicPlanShape(plan),
        review,
      },
    });
  } catch (err) {
    next(err);
  }
};
// ─── GET /api/dashboard/sprint/tasks/:taskId/review ───
exports.getSprintTaskReview = async (req, res, next) => {
  try {
    const plan = await getActivePlan(req.user._id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "No active sprint plan" });
    }

    const task = plan.tasks.find((t) => t.taskId === req.params.taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found in plan" });
    }

    if (!task.attempt || !task.attempt.submittedAt || !task.attempt.questionIds?.length) {
      return res.status(400).json({ success: false, message: "Task review not available" });
    }

    const questions = await Question.find({ _id: { $in: task.attempt.questionIds } }).lean();
    const qById = new Map(questions.map((q) => [String(q._id), q]));

    const review = task.attempt.questionIds.map((qid, idx) => {
      const q = qById.get(String(qid));
      const ans = task.attempt.answers?.[idx] || {};
      return {
        index: idx,
        questionId: qid,
        questionText: q?.questionText || "",
        choiceA: q?.choiceA || "",
        choiceB: q?.choiceB || "",
        choiceC: q?.choiceC || "",
        choiceD: q?.choiceD || "",
        section: q?.section || "",
        topic: canonicalTopic(q?.topic) || "",
        correctAnswer: q?.correctAnswer || null,
        explanationCorrect: q?.explanationCorrect || "",
        explanationWrong: q?.explanationWrong || "",
        reviewlyTip: q?.reviewlyTip || "",
        selectedAnswer: ans?.selectedAnswer || null,
        isCorrect: !!ans?.isCorrect,
      };
    });

    const taskTopic = (task.topics && task.topics.length > 0)
      ? task.topics.join(' + ')
      : task.sectionLabel || prettySection(task.section);

    res.json({
      success: true,
      data: {
        result: task.attempt.result,
        reviewer: {
          _id: task.taskId,
          title: task.title,
          type: 'sprint_task',
        },
        taskTopic,
        sprintPlan: publicPlanShape(plan),
        questions: review,
      },
    });
  } catch (err) {
    next(err);
  }
};
// ─── PUT /api/dashboard/sprint/tasks/:taskId/answer ───
// Save a single answer (autosave).

exports.saveSprintTaskAnswer = async (req, res, next) => {
  try {
    if (!isPremiumActive(req.user)) {
      return res.status(402).json({
        success: false,
        code: "premium_required",
        feature: "start_sprint_task",
        message: "Unlock Premium to save sprint answers.",
      });
    }

    const { questionIndex, selectedAnswer } = req.body || {};
    if (!Number.isInteger(questionIndex) || questionIndex < 0) {
      return res.status(400).json({ success: false, message: "Invalid question index" });
    }
    const valid = ["A", "B", "C", "D", null].includes(selectedAnswer);
    if (!valid) {
      return res.status(400).json({ success: false, message: "Invalid answer" });
    }

    const plan = await getActivePlan(req.user._id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "No active sprint plan" });
    }

    const task = plan.tasks.find((t) => t.taskId === req.params.taskId);
    if (!task || task.status === "completed") {
      return res.status(404).json({ success: false, message: "Task not available" });
    }

    if (!task.attempt || questionIndex >= (task.attempt.answers?.length || 0)) {
      return res.status(400).json({ success: false, message: "Index out of range" });
    }

    task.attempt.answers[questionIndex].selectedAnswer = selectedAnswer || null;
    plan.markModified("tasks");
    await plan.save();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
