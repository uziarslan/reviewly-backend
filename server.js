require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

// ── Connect to MongoDB ──────────────────────────
connectDB();

const app = express();

// ── Middleware ───────────────────────────────────
const allowedOrigins = [
  process.env.DOMAIN_FRONTEND || "http://localhost:3000",
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

// ── Start server ────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀  Server running on http://localhost:${PORT}`)
);
