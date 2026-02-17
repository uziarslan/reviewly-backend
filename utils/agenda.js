const Agenda = require("agenda");
const { syncQuestionsFromSheet } = require("../controllers/syncController");

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
    console.log("✅ Agenda ready");
  });

  agenda.on("error", (err) => {
    console.error("❌ Agenda error:", err.message);
  });

  agenda.on("start", (job) => {
    console.log(`▶️ Job started: ${job.attrs.name}`);
  });

  agenda.on("complete", (job) => {
    console.log(`✅ Job completed: ${job.attrs.name}`);
  });

  /**
   * Define the sync-questions job
   */
  agenda.define("sync-questions-from-sheet", async (job) => {
    console.log("\n🚀 Running scheduled task: sync-questions-from-sheet");
    
    try {
      const result = await syncQuestionsFromSheet({
        spreadsheetId: process.env.GOOGLE_SHEETS_QUESTIONS_ID,
        sheetName: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET,
      });

      console.log("✅ Job completed successfully:", result);
      job.attrs.lastFinishedAt = new Date();
    } catch (err) {
      console.error("❌ Job failed:", err.message);
      job.attrs.failReason = err.message;
    }
  });
}

/**
 * Start Agenda and schedule recurring jobs
 */
async function startAgenda() {
  if (!agenda) {
    console.error("❌ Agenda not initialized. Call initAgenda first.");
    return;
  }
  
  try {
    await agenda.start();
    console.log("✅ Agenda started");

    // Cancel any stale jobs from previous runs before rescheduling
    await agenda.cancel({ name: "sync-questions-from-sheet" });

    // Schedule the sync job to run every 12 hours
    const syncInterval = process.env.AGENDA_SYNC_INTERVAL || "12 hours";
    await agenda.every(syncInterval, "sync-questions-from-sheet");
    console.log(`📅 Scheduled: sync-questions-from-sheet every ${syncInterval}`);
  } catch (err) {
    console.error("❌ Error starting Agenda:", err.message);
  }
}

/**
 * Stop Agenda gracefully
 */
async function stopAgenda() {
  if (!agenda) return;
  
  try {
    await agenda.stop();
    console.log("✅ Agenda stopped");
  } catch (err) {
    console.error("❌ Error stopping Agenda:", err.message);
  }
}

/**
 * Manually trigger the sync (for testing)
 */
async function triggerSync() {
  if (!agenda) {
    console.error("❌ Agenda not initialized");
    return;
  }
  
  try {
    await agenda.now("sync-questions-from-sheet");
    console.log("🔄 Manual sync triggered");
  } catch (err) {
    console.error("❌ Error triggering sync:", err.message);
  }
}

module.exports = {
  initAgenda,
  startAgenda,
  stopAgenda,
  triggerSync,
};
