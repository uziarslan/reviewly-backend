const mongoose = require("mongoose");

const coverageItemSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true },
    itemCount: { type: String, required: true },
    topics: [{ type: String }],
  },
  { _id: false }
);

const importantNoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const reviewerSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["mock", "practice", "demo"],
      required: true,
    },
    access: {
      type: String,
      enum: ["free", "premium"],
      default: "free",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      short: { type: String, required: true },
      full: { type: String, required: true },
    },
    logo: {
      filename: { type: String, default: "cselogo.png" },
      path: { type: String, default: "/assets/cselogo.png" },
    },
    details: {
      items: { type: String },
      duration: { type: String },
      passingRate: { type: String, default: null },
      accessLevel: { type: String, default: null },
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
    },
    // ── Exam-specific config (used by exam assembly) ──
    examConfig: {
      // exam variant: dynamic = new questions each attempt; fixed = same set
      variant: {
        type: String,
        enum: ["dynamic", "fixed"],
        default: "dynamic",
      },
      // exam_family filter (e.g. "cse")
      examFamily: { type: String, default: "cse" },
      // exam_level filter (e.g. ["professional","both"])
      examLevel: [{ type: String }],
      // For fixed exams: predefined question set id
      fixedQuestionSetId: { type: String, default: null },
      // Total items in the exam
      totalItems: { type: Number, required: true },
      // Time in seconds (0 = no time limit)
      timeLimitSeconds: { type: Number, default: 0 },
      // Passing threshold percentage (null = no pass/fail)
      passingThreshold: { type: Number, default: null },
      // Section distribution for question assembly
      // e.g. [{ section: "verbal", count: 45 }]
      sectionDistribution: [
        {
          section: { type: String },
          count: { type: Number },
          _id: false,
        },
      ],
      // Difficulty distribution (global or per-section)
      difficultyDistribution: {
        easy: { type: Number, default: 30 },   // percentage
        medium: { type: Number, default: 50 },
        hard: { type: Number, default: 20 },
      },
    },
    // ── Exam details shown on ExamDetails page ──
    examDetails: {
      timeFormatted: { type: String },
      itemsCount: { type: Number },
      progress: { type: String, default: "Not Started" },
      bannerImage: { type: String, default: null },
      // Intro text (before coverage): short tagline + full paragraph
      introShort: { type: String, default: null },
      introFull: { type: String, default: null },
      // Applicability (e.g. "Professional & Sub-Professional")
      applicableFor: { type: String, default: null },
      accessFor: { type: String, default: null },
      coverage: [coverageItemSchema],
      //Coverage end text
      coverageEndText: { type: String, default: null },
      // Text after coverage (e.g. difficulty note)
      difficultyText: { type: String, default: null },
      // Disclaimer at the end
      disclaimer: { type: String, default: null },
      importantNotes: [importantNoteSchema],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reviewer", reviewerSchema);
