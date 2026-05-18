const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    profilePic: {
      type: String,
      default: "",
    },
    passwordHash: {
      type: String,
      default: null,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    blocked: {
      type: Boolean,
      default: false,
    },
    // IDs of reviewers the user has bookmarked
    library: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Reviewer",
      },
    ],
    subscription: {
      plan: {
        type: String,
        enum: ["free", "weekly", "monthly", "quarterly", "premium"],
        default: "free",
      },
      startDate: {
        type: Date,
        default: null,
      },
      expiresAt: {
        type: Date,
        default: null,
      },
    },
    marketingEmails: {
      type: Boolean,
      default: true,
    },
    // Whether user has completed/skipped the one-time trial assessment
    trialAssessment: {
      type: Boolean,
      default: false,
    },
    // Civil Service Exam track the user is preparing for. Drives the dashboard
    // section breakdown, sprint generation, and mock recommendations regardless
    // of which exams they actually take on the Reviewer page. Null until the
    // user picks one (during onboarding) or changes it from Account Settings.
    examType: {
      type: String,
      enum: ["professional", "subprofessional", null],
      default: null,
    },
    // Optional exam date used by the Readiness Checker to show "days before CSE".
    // When null the days block is hidden.
    examDate: {
      type: Date,
      default: null,
    },
    // Last time the user opened the What's New page. Drives the yellow-dot
    // notification indicator (unread = a published entry newer than this).
    whatsNewSeenAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
