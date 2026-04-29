const mongoose = require("mongoose");

const sprintTaskSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true },
    day: { type: Number, required: true },
    type: {
      type: String,
      enum: [
        "topic_practice",
        "reinforcement_dual_topic",
        "section_mixed",
        "secondary_section_practice",
        "primary_section_reinforcement",
        "timed_mixed_check",
      ],
      required: true,
    },
    title: { type: String, required: true },
    section: { type: String, required: true }, // db-form, e.g. "verbal"
    sections: [{ type: String }], // for timed_mixed_check
    topics: [{ type: String }],
    questionCount: { type: Number, required: true },
    estimatedMinutes: { type: Number, required: true },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed"],
      default: "not_started",
    },
    // Active task attempt (questions selected for this task)
    attempt: {
      questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
      answers: [
        {
          question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
          selectedAnswer: { type: String, enum: ["A", "B", "C", "D", null], default: null },
          isCorrect: { type: Boolean, default: false },
          _id: false,
        },
      ],
      startedAt: { type: Date, default: null },
      submittedAt: { type: Date, default: null },
      result: {
        totalItems: { type: Number, default: 0 },
        correct: { type: Number, default: 0 },
        incorrect: { type: Number, default: 0 },
        unanswered: { type: Number, default: 0 },
        percentage: { type: Number, default: 0 },
      },
    },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

const sprintPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    examFamily: { type: String, default: "cse" },
    examLevel: {
      type: String,
      enum: ["professional", "subprofessional"],
      required: true,
    },
    // What attempt the plan was generated from
    sourceType: {
      type: String,
      enum: ["assessment", "mock_exam", "recent_full_mocks"],
      required: true,
    },
    sourceAttempts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Attempt" },
    ],
    primarySection: { type: String, required: true },
    secondarySection: { type: String, default: null },
    tasks: [sprintTaskSchema],
    status: {
      type: String,
      enum: ["active", "abandoned", "completed"],
      default: "active",
    },
    completedTasks: { type: Number, default: 0 },
    totalTasks: { type: Number, default: 7 },
  },
  { timestamps: true }
);

// One active sprint plan per user — query helper relies on this
sprintPlanSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model("SprintPlan", sprintPlanSchema);
