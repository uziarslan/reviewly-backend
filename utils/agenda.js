const Agenda = require("agenda");
const { syncQuestionsFromSheet } = require("../controllers/syncController");

let agenda = null;

/**
 * Initialize Agenda with MongoDB client
 */
function initAgenda(mongoDb) {
  agenda = new Agenda({
    mongo: mongoDb,
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

    // Schedule the sync job to run every 12 hours
    await agenda.every("12 hours", "sync-questions-from-sheet");
    console.log("📅 Scheduled: sync-questions-from-sheet every 12 hours");
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
