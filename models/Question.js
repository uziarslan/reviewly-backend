const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    examFamily: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    examLevel: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    section: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    module: {
      type: String,
      default: "",
      trim: true,
    },
    topic: {
      type: String,
      default: "",
      trim: true,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      required: true,
      lowercase: true,
    },
    questionText: {
      type: String,
      required: true,
    },
    choiceA: { type: String, required: true },
    choiceB: { type: String, required: true },
    choiceC: { type: String, required: true },
    choiceD: { type: String, required: true },
    correctAnswer: {
      type: String,
      required: true,
      uppercase: true,
      enum: ["A", "B", "C", "D"],
    },
    explanationCorrect: { type: String, default: "" },
    explanationWrong: { type: String, default: "" },
    reviewlyTip: { type: String, default: "" },
    status: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved",
      lowercase: true,
    },
    batchId: { type: String, default: "" },
    source: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

// Index for fast exam assembly queries
questionSchema.index({ status: 1, examFamily: 1, examLevel: 1, section: 1, difficulty: 1 });

module.exports = mongoose.model("Question", questionSchema);
