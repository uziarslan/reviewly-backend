require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const { initAgenda, startAgenda, stopAgenda, triggerSync } = require("./utils/agenda");
const { syncQuestionsFromSheet } = require("./controllers/syncController");

// ── Connect to MongoDB ──────────────────────────
let mongoDb = null;
connectDB().then((db) => {
  mongoDb = db;
  console.log("✅ MongoDB instance acquired");
}).catch((err) => {
  console.error("❌ Failed to connect to MongoDB:", err.message);
});

const app = express();

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

// ── Routes ──────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/reviewers", require("./routes/reviewers"));
app.use("/api/library", require("./routes/library"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/attempts", require("./routes/attempts"));
app.use("/api/ai", require("./routes/ai"));
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
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// ── Start server and Agenda ─────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, async () => {
  console.log(`🚀  Server running on http://localhost:${PORT}`);
  
  // Wait for MongoDB to be connected
  const maxRetries = 30;
  let retries = 0;
  while (!mongoDb && retries < maxRetries) {
    console.log("⏳ Waiting for MongoDB connection...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }

  if (!mongoDb) {
    console.error("❌ MongoDB connection failed, skipping Agenda initialization");
    return;
  }

  // Initialize and start Agenda for scheduled jobs
  try {
    initAgenda(mongoDb);
    await startAgenda();
  } catch (err) {
    console.error("⚠️  Failed to start Agenda:", err.message);
  }
});

// ── Graceful shutdown ───────────────────────────
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await stopAgenda();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  await stopAgenda();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
