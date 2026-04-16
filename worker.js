require("dotenv").config();

const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { initAgenda, startAgenda, stopAgenda } = require("./utils/agenda");

let shuttingDown = false;

async function startWorker() {
  try {
    logger.info("Starting Agenda worker process");
    const mongoDb = await connectDB();
    initAgenda(mongoDb);
    await startAgenda({ withRecurringSync: true });
    logger.info("Agenda worker started");
  } catch (err) {
    logger.error({ err }, "Failed to start Agenda worker");
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Agenda worker shutting down");

  try {
    await stopAgenda();
  } catch (err) {
    logger.error({ err }, "Error while stopping Agenda worker");
  }

  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection in Agenda worker");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception in Agenda worker");
  process.exit(1);
});

startWorker();
