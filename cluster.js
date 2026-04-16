require("dotenv").config();
const logger = require("./utils/logger");
const { startServer } = require("./server");

// Keep this file as a compatibility entrypoint but intentionally avoid clustering.
// Heroku dynos should run one Node process and scale with dyno count, not CPU worker forks.
startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
