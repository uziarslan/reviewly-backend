const Agenda = require("agenda");
const logger = require("./logger");
const { syncQuestionsFromSheet } = require("../controllers/syncController");
const Attempt = require("../models/Attempt");
const { generateGeminiAnalysis } = require("./gemini");

let agenda = null;

/**
 * Initialize Agenda with MongoDB client
 */
function initAgenda(mongoDb) {
  const agendaConfig = process.env.MONGO_URI
    ? {
        db: {
          address: process.env.MONGO_URI,
          collection: "agendaJobs",
        },
      }
    : { mongo: mongoDb };

  agenda = new Agenda({
    ...agendaConfig,
    processEvery: "5 seconds",
  });

  agenda.on("ready", () => {
    logger.info("Agenda ready");
  });

  agenda.on("error", (err) => {
    logger.error({ err }, "Agenda error");
  });

  agenda.on("start", (job) => {
    logger.info({ job: job.attrs.name }, "Job started");
  });

  agenda.on("complete", (job) => {
    logger.info({ job: job.attrs.name }, "Job completed");
  });

  /**
   * Define the sync-questions job
   */
  /**
   * Define the process-exam-ai-analysis job
   */
  agenda.define("process-exam-ai-analysis", { concurrency: 3 }, async (job) => {
    const { attemptId } = job.attrs.data || {};
    if (!attemptId) {
      logger.error("process-exam-ai-analysis: missing attemptId");
      return;
    }
    try {
      const attempt = await Attempt.findById(attemptId)
        .populate("reviewer")
        .populate("questions");
      if (!attempt || attempt.status !== "submitted") {
        logger.error("process-exam-ai-analysis: attempt not found or not submitted");
        return;
      }
      if (attempt.result.aiStatus === "complete" || attempt.result.aiStatus === "failed") {
        return;
      }
      attempt.result.aiStatus = "processing";
      attempt.markModified("result");
      await attempt.save();

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
      attempt.markModified("result");
      await attempt.save();
    } catch (err) {
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

  agenda.define("sync-questions-from-sheet", async (job) => {
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
}

/**
 * Start Agenda and schedule recurring jobs
 */
async function startAgenda() {
  if (!agenda) {
    logger.error("Agenda not initialized. Call initAgenda first.");
    return;
  }
  
  try {
    await agenda.start();
    logger.info("Agenda started");

    // Cancel any stale jobs from previous runs before rescheduling
    await agenda.cancel({ name: "sync-questions-from-sheet" });

    // Schedule the sync job to run every 12 hours
    const syncInterval = process.env.AGENDA_SYNC_INTERVAL || "12 hours";
    await agenda.every(syncInterval, "sync-questions-from-sheet");
    logger.info({ syncInterval }, "Scheduled: sync-questions-from-sheet");
  } catch (err) {
    logger.error({ err }, "Error starting Agenda");
  }
}

/**
 * Stop Agenda gracefully
 */
async function stopAgenda() {
  if (!agenda) return;
  
  try {
    await agenda.stop();
    logger.info("Agenda stopped");
  } catch (err) {
    logger.error({ err }, "Error stopping Agenda");
  }
}

/**
 * Manually trigger the sync (for testing)
 */
async function triggerSync() {
  if (!agenda) {
    logger.error("Agenda not initialized");
    return;
  }
  
  try {
    await agenda.now("sync-questions-from-sheet");
    logger.info("Manual sync triggered");
  } catch (err) {
    logger.error({ err }, "Error triggering sync");
  }
}

/**
 * Enqueue AI analysis for an exam attempt (non-blocking)
 */
async function enqueueExamAIAnalysis(attemptId) {
  if (!agenda) {
    logger.error("Agenda not initialized, cannot enqueue process-exam-ai-analysis");
    return;
  }
  try {
    await agenda.now("process-exam-ai-analysis", { attemptId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue process-exam-ai-analysis");
  }
}

module.exports = {
  initAgenda,
  startAgenda,
  stopAgenda,
  triggerSync,
  enqueueExamAIAnalysis,
};
