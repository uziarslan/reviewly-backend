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
    // Last time the client confirmed the timer was actively ticking (via saveAnswer/beacon).
    // Cleared on pause. Used on resume to subtract elapsed time since last sync.
    tickedAt: { type: Date, default: null },
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
      performanceLevel: { type: String, default: null }, // Strong / Developing / Needs Improvement (practice exams)
      duration: { type: Number, default: null }, // total time spent in seconds
      // Backend-generated recommended next steps (CTAs)
      recommendedNextStep: {
        ctas: [
          {
            type: {
              type: String,
              enum: [
                "take_section_practice",
                "retake_full_mock",
                "retake_section",
                "review_answers",
                "try_full_mock",
                "go_to_dashboard",
                "upgrade_premium",
                "retake_demo",
              ],
            },
            label: { type: String },
            reviewerId: { type: mongoose.Schema.Types.ObjectId },
            isHighestImpact: { type: Boolean, default: false },
            priority: { type: String },
          },
        ],
      },
    },
    // Public share token (generated on demand)
    shareToken: { type: String },
    // Score card image for OG link previews (stored as JPEG buffer)
    shareImage: { type: Buffer, default: null },
    // Cloudinary URL for the generated share image
    shareImageUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

attemptSchema.index({ user: 1, reviewer: 1, status: 1 });
attemptSchema.index({ user: 1, reviewer: 1, createdAt: -1 });
attemptSchema.index({ shareToken: 1 }, { unique: true, sparse: true });
// Prevents duplicate in-progress attempts for the same user+reviewer (guards against race conditions)
attemptSchema.index(
  { user: 1, reviewer: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' }, name: 'user_reviewer_in_progress_unique' }
);

module.exports = mongoose.model("Attempt", attemptSchema);
