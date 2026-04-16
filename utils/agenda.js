const Agenda = require("agenda");
const logger = require("./logger");
const { syncQuestionsFromSheet } = require("../controllers/syncController");
const Attempt = require("../models/Attempt");
const { generateGeminiAnalysis } = require("./gemini");

let agendaInstance = null;
let startPromise = null;

/**
 * Initialize Agenda with MongoDB client
 */
function initAgenda(mongoDb) {
  if (agendaInstance) {
    return agendaInstance;
  }

  if (!mongoDb && !process.env.MONGO_URI) {
    throw new Error("Agenda requires a MongoDB connection or MONGO_URI.");
  }

  const agendaConfig = mongoDb
    ? {
      mongo: mongoDb,
      db: { collection: "agendaJobs" },
    }
    : {
      db: {
        address: process.env.MONGO_URI,
        collection: "agendaJobs",
      },
    };

  agendaInstance = new Agenda({
    ...agendaConfig,
    processEvery: "5 seconds",
  });

  console.log("[AGENDA INIT] Agenda instance created", {
    collection: "agendaJobs",
    usingMongoDb: !!mongoDb,
    usingMongoUri: !mongoDb && !!process.env.MONGO_URI,
  });

  agendaInstance.on("ready", () => {
    logger.info("Agenda ready");
  });

  agendaInstance.on("error", (err) => {
    logger.error({ err }, "Agenda error");
  });

  agendaInstance.on("start", (job) => {
    logger.info({ job: job.attrs.name }, "Job started");
    console.log("[AGENDA LISTENER] job started", { name: job.attrs.name, id: job.attrs._id });
  });

  agendaInstance.on("complete", (job) => {
    logger.info({ job: job.attrs.name }, "Job completed");
    console.log("[AGENDA LISTENER] job completed", { name: job.attrs.name, id: job.attrs._id });
  });

  /**
   * Define the sync-questions job
   */
  /**
   * Define the process-exam-ai-analysis job
   */
  agendaInstance.define("process-exam-ai-analysis", { concurrency: 3 }, async (job) => {
    const { attemptId } = job.attrs.data || {};
    console.log("[JOB EXECUTION STARTED]", { attemptId, jobId: job.attrs._id, data: job.attrs.data });
    if (!attemptId) {
      logger.error("process-exam-ai-analysis: missing attemptId");
      return;
    }
    console.log("[AGENDA JOB STARTED] process-exam-ai-analysis", {
      attemptId,
      jobId: job.attrs._id,
    });
    console.log("[AI JOB START]", { attemptId });
    try {
      const attempt = await Attempt.findById(attemptId)
        .populate("reviewer")
        .populate("questions");
      console.log("[AI JOB FETCH ATTEMPT]", {
        attemptId,
        found: !!attempt,
        status: attempt?.status,
        aiStatus: attempt?.result?.aiStatus,
      });
      if (!attempt || attempt.status !== "submitted") {
        console.log("[AI JOB SKIP] attempt not found or not submitted", {
          attemptId,
          status: attempt?.status,
        });
        logger.error("process-exam-ai-analysis: attempt not found or not submitted");
        return;
      }
      if (attempt.result.aiStatus === "complete" || attempt.result.aiStatus === "failed") {
        console.log("[AI JOB SKIP] attempt already terminal", {
          attemptId,
          aiStatus: attempt.result.aiStatus,
        });
        return;
      }
      attempt.result.aiStatus = "processing";
      console.log("[AI JOB STATUS] set aiStatus=processing", { attemptId });
      attempt.markModified("result");
      await attempt.save();
      console.log("[AI JOB STATUS SAVED] processing state persisted", { attemptId });

      const result = attempt.result || {};
      const reviewer = attempt.reviewer;
      const examType = reviewer?.type || "mock";
      const sectionScores = result.sectionScores || [];
      const sectionName = examType === "practice" && sectionScores.length > 0
        ? sectionScores[0].section
        : null;
      const timeSpentSeconds = result.duration ?? (attempt.submittedAt && attempt.startedAt
        ? Math.round((new Date(attempt.submittedAt) - new Date(attempt.startedAt)) / 1000)
        : null);

      console.log("[AI JOB GEMINI CALL] about to call generateGeminiAnalysis", {
        attemptId,
        examType,
        percentage: result.percentage,
        totalItems: result.totalItems,
        sectionName,
      });
      const aiAnalysis = await generateGeminiAnalysis({
        totalItems: result.totalItems || 0,
        correct: result.correct || 0,
        percentage: result.percentage || 0,
        sectionScores,
        passed: result.passed,
        passingThreshold: reviewer?.examConfig?.passingThreshold,
        examType,
        unanswered: result.unanswered || 0,
        timeSpentSeconds,
        sectionName,
      });
      console.log("[AI JOB GEMINI RESPONSE]", {
        attemptId,
        hasResponse: !!aiAnalysis,
        responseKeys: aiAnalysis ? Object.keys(aiAnalysis) : [],
      });

      if (!aiAnalysis) {
        console.log("[AI JOB GEMINI NO_RESPONSE]", { attemptId });
      }
      if (aiAnalysis) {
        if (examType === "practice") {
          attempt.result.quickSummary = aiAnalysis.quickSummary || null;
          attempt.result.timeInsight = aiAnalysis.timeInsight || null;
        } else {
          attempt.result.strengths = aiAnalysis.strengths;
          attempt.result.improvements = aiAnalysis.improvements;
          attempt.result.aiSummary = aiAnalysis.summary || null;
          attempt.result.quickSummary = aiAnalysis.quickSummary || null;
          attempt.result.sectionAnalysis = aiAnalysis.sectionAnalysis || [];
        }
      }
      attempt.result.aiStatus = "complete";
      console.log("[AI JOB STATUS] set aiStatus=complete", { attemptId });
      attempt.markModified("result");
      console.log("[AI JOB SAVE] saving final AI result", { attemptId });
      await attempt.save();
      console.log("[AI JOB COMPLETE] saved AI result", { attemptId });
    } catch (err) {
      console.log("[AI JOB ERROR] processing failed", { attemptId, error: err?.message || err });
      logger.error({ err, attemptId }, "process-exam-ai-analysis failed");
      try {
        const attempt = await Attempt.findById(attemptId);
        if (attempt && attempt.result) {
          attempt.result.aiStatus = "failed";
          attempt.markModified("result");
          await attempt.save();
        }
      } catch (saveErr) {
        logger.error({ err: saveErr }, "Failed to set aiStatus=failed");
      }
    }
  });

  agendaInstance.define("sync-questions-from-sheet", async (job) => {
    logger.info("Running scheduled task: sync-questions-from-sheet");

    try {
      const result = await syncQuestionsFromSheet({
        spreadsheetId: process.env.GOOGLE_SHEETS_QUESTIONS_ID,
        sheetName: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET,
      });

      logger.info({ result }, "sync-questions-from-sheet completed successfully");
      job.attrs.lastFinishedAt = new Date();
    } catch (err) {
      logger.error({ err }, "sync-questions-from-sheet Job failed");
      job.attrs.failReason = err.message;
    }
  });

  return agendaInstance;
}

/**
 * Start Agenda and schedule recurring jobs
 */
async function startAgenda(options = {}) {
  if (!agendaInstance) {
    throw new Error("Agenda not initialized");
  }

  if (startPromise) {
    return startPromise;
  }

  const {
    withRecurringSync = false,
    syncInterval = process.env.AGENDA_SYNC_INTERVAL || "12 hours",
  } = options;

  startPromise = (async () => {
    try {
      await agendaInstance.start();
      console.log("[AGENDA STARTED] processing loop active");
      logger.info("Agenda started");

      const jobs = await agendaInstance.jobs({});
      console.log("[AGENDA JOBS] total jobs visible to worker", {
        total: jobs.length,
        sampleJobs: jobs.slice(0, 10).map((j) => ({
          name: j.attrs.name,
          nextRunAt: j.attrs.nextRunAt,
          lastRunAt: j.attrs.lastRunAt,
          failedAt: j.attrs.failedAt,
          data: j.attrs.data,
        })),
      });

      if (withRecurringSync) {
        // Cancel any stale jobs from previous runs before rescheduling.
        await agendaInstance.cancel({ name: "sync-questions-from-sheet" });
        await agendaInstance.every(syncInterval, "sync-questions-from-sheet");
        logger.info({ syncInterval }, "Scheduled: sync-questions-from-sheet");
      }
    } catch (err) {
      logger.error({ err }, "Error starting Agenda");
      startPromise = null;
      throw err;
    }
  })();

  return startPromise;
}

/**
 * Stop Agenda gracefully
 */
async function stopAgenda() {
  if (!agendaInstance) return;

  try {
    await agendaInstance.stop();
    startPromise = null;
    logger.info("Agenda stopped");
  } catch (err) {
    logger.error({ err }, "Error stopping Agenda");
  }
}

/**
 * Manually trigger the sync (for testing)
 */
async function triggerSync() {
  if (!agendaInstance) {
    throw new Error("Agenda not initialized");
  }

  try {
    await agendaInstance.now("sync-questions-from-sheet");
    logger.info("Manual sync triggered");
  } catch (err) {
    logger.error({ err }, "Error triggering sync");
  }
}

/**
 * Enqueue AI analysis for an exam attempt (non-blocking)
 */
async function enqueueExamAIAnalysis(attemptId) {
  const agenda = getAgendaInstance();
  console.log("[AGENDA ENQUEUE READY] exam AI job queued", { attemptId });
  try {
    await agenda.now("process-exam-ai-analysis", { attemptId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue process-exam-ai-analysis");
  }
}

function getAgendaInstance() {
  if (!agendaInstance) {
    throw new Error("Agenda not initialized");
  }
  return agendaInstance;
}

function getAgenda() {
  return agendaInstance;
}

module.exports = {
  initAgenda,
  startAgenda,
  stopAgenda,
  triggerSync,
  enqueueExamAIAnalysis,
  getAgendaInstance,
  getAgenda,
};
