const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    selectedAnswer: {
      type: String,
      enum: ["A", "B", "C", "D", null],
      default: null,
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const sectionScoreSchema = new mongoose.Schema(
  {
    section: { type: String, required: true },
    totalItems: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    incorrect: { type: Number, default: 0 },
    unanswered: { type: Number, default: 0 },
    score: { type: Number, default: 0 }, // percentage
  },
  { _id: false }
);

const sectionAnalysisSchema = new mongoose.Schema(
  {
    section: { type: String, required: true },
    lines: [{ type: String }],
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reviewer",
      required: true,
    },
    // Ordered list of questions for this attempt
    questions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
      },
    ],
    // User answers (parallel array with questions)
    answers: [answerSchema],
    // Status
    status: {
      type: String,
      enum: ["in_progress", "submitted", "timed_out"],
      default: "in_progress",
    },
    // Current question index (for resume)
    currentIndex: {
      type: Number,
      default: 0,
    },
    // Timer
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    // remaining time in seconds when paused (for resume)
    remainingSeconds: { type: Number, default: null },
    // Results (filled on submission)
    result: {
      totalItems: { type: Number, default: 0 },
      correct: { type: Number, default: 0 },
      incorrect: { type: Number, default: 0 },
      unanswered: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 },
      passed: { type: Boolean, default: false },
      passingScore: { type: Number, default: null },
      sectionScores: [sectionScoreSchema],
      strengths: [{ type: String }],
      improvements: [{ type: String }],
      aiSummary: { type: String, default: null },
      quickSummary: { type: String, default: null },
      performanceLevel: { type: String, default: null }, // Strong / Developing / Needs Improvement (practice exams)
      timeInsight: { type: String, default: null }, // AI-generated pacing insight (practice exams)
      sectionAnalysis: [sectionAnalysisSchema],
    },
  },
  { timestamps: true }
);

attemptSchema.index({ user: 1, reviewer: 1, status: 1 });
// Unique constraint: one attempt per user per reviewer
attemptSchema.index({ user: 1, reviewer: 1 }, { unique: true });

module.exports = mongoose.model("Attempt", attemptSchema);
