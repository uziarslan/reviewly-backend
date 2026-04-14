require("dotenv").config();
const cluster = require("cluster");
const logger = require("./utils/logger");
const os = require("os");
const connectDB = require("./config/db");
const { initAgenda, startAgenda, stopAgenda } = require("./utils/agenda");

const numWorkers = process.env.CLUSTER_WORKERS
  ? parseInt(process.env.CLUSTER_WORKERS, 10)
  : os.cpus().length;

const CRASH_WINDOW_MS = 60000;
const MAX_CRASHES = 5;

if (cluster.isPrimary || cluster.isMaster) {
  (async () => {
    let mongoDb;
    try {
      mongoDb = await connectDB();
      logger.info("MongoDB instance acquired (primary)");
    } catch (err) {
      logger.error({ err }, "Failed to connect to MongoDB");
      process.exit(1);
    }

    try {
      initAgenda(mongoDb);
      await startAgenda();
      logger.info("Agenda started in primary process");
    } catch (err) {
      logger.error({ err }, "Failed to start Agenda");
    }

    const crashTimestamps = [];

    const forkWorker = () => {
      const worker = cluster.fork();
      worker.on("exit", (code, signal) => {
        if (code === 0 && !signal) return;
        const now = Date.now();
        crashTimestamps.push(now);
        while (crashTimestamps.length > 0 && now - crashTimestamps[0] >= CRASH_WINDOW_MS) {
          crashTimestamps.shift();
        }
        if (crashTimestamps.length > MAX_CRASHES) {
          logger.error(
            { maxCrashes: MAX_CRASHES, windowMs: CRASH_WINDOW_MS },
            `CRITICAL: Worker crashed more than ${MAX_CRASHES} times within 60 seconds. Stopping respawn to prevent crash loop.`
          );
          return;
        }
        setTimeout(forkWorker, 500);
      });
    };

    for (let i = 0; i < numWorkers; i++) {
      forkWorker();
    }

    logger.info({ numWorkers }, "Primary process started, forked worker(s)");

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received in primary, shutting down...");
      await stopAgenda();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received in primary, shutting down...");
      await stopAgenda();
      process.exit(0);
    });
  })();
} else {
  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ reason, promise }, "Unhandled rejection in worker");
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception in worker");
    process.exit(1);
  });

  const { startServer } = require("./server");
  startServer();
}
