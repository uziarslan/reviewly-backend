const mongoose = require("mongoose");

/**
 * A single "What's New" bulletin entry shown to users on the dashboard.
 * Admin-authored. Only `published` entries are visible to users; the
 * per-user yellow-dot indicator compares `publishedAt` against the
 * user's `whatsNewSeenAt`.
 */
const whatsNewSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["new", "improved", "bugfix", "announcement"],
      required: true,
    },
    // Whether to show the "BASED ON USER FEEDBACK" pill.
    feedbackTag: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    imageUrl: {
      type: String,
      default: "",
    },
    // Cloudinary public_id, retained so the image can be deleted on
    // update/remove.
    imagePublicId: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    // Set the first time the entry is published. Used both as the displayed
    // date and for the unread/yellow-dot comparison. Kept stable if the
    // entry is later toggled back to draft and re-published.
    publishedAt: {
      type: Date,
      default: null,
    },
    // Internal timestamp used for unread-dot logic. Unlike publishedAt,
    // this always captures the real first publish moment (with time), so
    // date-only admin inputs do not suppress unread indicators.
    publishedMarkerAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

whatsNewSchema.index({ status: 1, publishedMarkerAt: -1, publishedAt: -1 });

module.exports = mongoose.model("WhatsNew", whatsNewSchema);
