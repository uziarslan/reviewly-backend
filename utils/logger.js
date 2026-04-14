const pino = require("pino");

const level = process.env.LOG_LEVEL || "info";
const isProduction = process.env.NODE_ENV === "production";

const options = {
  level,
};

if (!isProduction) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
    },
  };
}

const logger = pino(options);

module.exports = logger;
