const mongoose = require("mongoose");

/**
 * Generic key/value store for app-level settings (e.g. the next CSE exam
 * date). Use a single document per key.
 *
 * Currently used keys:
 *   - "cseExamDate" → ISO date for the next Civil Service Exam.
 */
const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    // Free-form value: stored as Mixed so callers can persist a Date, string,
    // number, or object as needed.
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
