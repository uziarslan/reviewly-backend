require("dotenv").config();
const express = require("express");
const logger = require("./utils/logger");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const connectDB = require("./config/db");
const { syncQuestionsFromSheet } = require("./controllers/syncController");
const posthog = require("./services/posthog");
const { authLimiter, supportLimiter, apiLimiter } = require("./middleware/rateLimit");

let dbReadyPromise = null;

function ensureDbConnected() {
  if (!dbReadyPromise) {
    dbReadyPromise = connectDB()
      .then((db) => {
        logger.info("MongoDB instance acquired");
        return db;
      })
      .catch((err) => {
        dbReadyPromise = null;
        throw err;
      });
  }
  return dbReadyPromise;
}

const app = express();
app.set("trust proxy", 1);

// ── Middleware ───────────────────────────────────
// DOMAIN_FRONTEND can be a single URL or comma-separated list (e.g. https://reviewly.ph,https://www.reviewly.ph)
const allowedOrigins = [
  ...(process.env.DOMAIN_FRONTEND
    ? process.env.DOMAIN_FRONTEND.split(",").map((s) => s.trim()).filter(Boolean)
    : ["http://localhost:3000"]),
  process.env.DOMAIN_ADMIN || "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server / curl (no origin) + listed origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(compression());

// ── Rate limiting ─────────────────────────────────
app.use("/api/auth", authLimiter);
app.use("/api/support", supportLimiter);
app.use("/api", apiLimiter);

// ── Routes ──────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/reviewers", require("./routes/reviewers"));
app.use("/api/library", require("./routes/library"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/trial-assessment", require("./routes/trialAssessment"));
app.use("/api/support", require("./routes/support"));

// ── Admin: Manual sync trigger ──────────────────
app.post("/api/admin/sync-questions", async (req, res, next) => {
  try {
    console.log("\n📢 Manual sync endpoint called");
    console.log("ENV values:", {
      GOOGLE_SHEETS_QUESTIONS_ID: process.env.GOOGLE_SHEETS_QUESTIONS_ID,
      GOOGLE_SHEETS_QUESTIONS_SHEET: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET,
    });

    if (!process.env.GOOGLE_SHEETS_QUESTIONS_ID || !process.env.GOOGLE_SHEETS_QUESTIONS_SHEET) {
      return res.status(400).json({
        success: false,
        message: "Google Sheets config missing",
        env: {
          id: process.env.GOOGLE_SHEETS_QUESTIONS_ID ? "✅ Set" : "❌ Missing",
          sheet: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET ? "✅ Set" : "❌ Missing",
        },
      });
    }

    const result = await syncQuestionsFromSheet({
      spreadsheetId: process.env.GOOGLE_SHEETS_QUESTIONS_ID,
      sheetName: process.env.GOOGLE_SHEETS_QUESTIONS_SHEET,
    });
    res.json({ success: true, message: "Sync completed", result });
  } catch (err) {
    console.error("❌ Sync error:", err.message);
    next(err);
  }
});

// ── Health check ────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ── Global error handler ────────────────────────
app.use((err, _req, res, _next) => {
  logger.error({ err, stack: err.stack }, "Unhandled error");
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// ── Start server ─────────────────────────────────
const PORT = process.env.PORT || 5000;
let server = null;

async function startServer() {
  await ensureDbConnected();

  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      logger.info({ port: PORT }, "Server running");
      resolve(server);
    });
  });
}

async function runDirect() {
  try {
    await startServer();
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

// ── Graceful shutdown ───────────────────────────
function registerShutdownHandlers() {
  const shutdown = async () => {
    logger.info("SIGTERM/SIGINT received, shutting down gracefully...");
    await posthog.shutdown();
    if (server) {
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

registerShutdownHandlers();

if (require.main === module) {
  runDirect();
} else {
  module.exports = { app, startServer, ensureDbConnected };
}
