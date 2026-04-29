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
        enum: ["free", "weekly", "monthly", "quarterly"],
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
    // Optional exam date used by the Readiness Checker to show "days before CSE".
    // When null the days block is hidden.
    examDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
