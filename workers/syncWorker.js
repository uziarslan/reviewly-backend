require("dotenv").config();

const connectDB = require("../config/db");
const logger = require("../utils/logger");
const { syncQuestionsFromSheet } = require("../controllers/syncController");

const SYNC_INTERVAL = process.env.GOOGLE_SHEETS_SYNC_INTERVAL || process.env.AGENDA_SYNC_INTERVAL || "12 hours";
const SHEET_CONFIG = {
  spreadsheetId: process.env.GOOGLE_SHEETS_QUESTIONS_ID,
  sheetName: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET,
};

function parseIntervalToMs(interval) {
  if (!interval || typeof interval !== "string") return null;
  const lower = interval.trim().toLowerCase();
  const match = lower.match(/^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days)$/);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value <= 0) return null;

  switch (unit) {
    case "second":
    case "seconds":
      return value * 1000;
    case "minute":
    case "minutes":
      return value * 60 * 1000;
    case "hour":
    case "hours":
      return value * 60 * 60 * 1000;
    case "day":
    case "days":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

async function runSync() {
  try {
    console.log("[SYNC WORKER] Starting Google Sheets sync...");
    const result = await syncQuestionsFromSheet(SHEET_CONFIG);
    console.log("[SYNC WORKER] Sync completed", result);
  } catch (err) {
    console.error("[SYNC WORKER] Sync failed", err?.message || err);
  }
}

async function startWorker() {
  try {
    if (!SHEET_CONFIG.spreadsheetId || !SHEET_CONFIG.sheetName) {
      console.error("[SYNC WORKER] Missing Google Sheets configuration. Set GOOGLE_SHEETS_QUESTIONS_ID and GOOGLE_SHEETS_QUESTIONS_SHEET.");
      process.exit(1);
    }

    const mongoDb = await connectDB();
    console.log("[WORKER STARTED] MongoDB connected");

    const intervalMs = parseIntervalToMs(SYNC_INTERVAL);
    if (!intervalMs) {
      console.error(
        `[SYNC WORKER] Invalid sync interval: ${SYNC_INTERVAL}. Use values like '12 hours', '30 minutes', or '1 day'.`
      );
      process.exit(1);
    }

    await runSync();

    setInterval(async () => {
      await runSync();
    }, intervalMs);

    process.on("SIGTERM", () => {
      console.log("[WORKER SHUTDOWN] SIGTERM received");
      process.exit(0);
    });

    process.on("SIGINT", () => {
      console.log("[WORKER SHUTDOWN] SIGINT received");
      process.exit(0);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[WORKER ERROR] unhandledRejection", reason);
    });

    process.on("uncaughtException", (err) => {
      console.error("[WORKER ERROR] uncaughtException", err);
      process.exit(1);
    });

    console.log("[WORKER READY] Google Sheets sync worker running every", SYNC_INTERVAL);
  } catch (err) {
    logger.error({ err }, "Failed to start Google Sheets sync worker");
    process.exit(1);
  }
}

startWorker();
