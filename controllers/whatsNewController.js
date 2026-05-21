const WhatsNew = require("../models/WhatsNew");
const User = require("../models/User");
const { cloudinary } = require("../cloudinary");

const VALID_TYPES = ["new", "improved", "bugfix", "announcement"];

/** Coerce a multipart string ("true"/"false"/"1") or boolean into a boolean. */
function toBool(v) {
  return v === true || v === "true" || v === "1";
}

function parsePublishDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Public-facing shape (no Cloudinary internals). */
function publicEntry(doc) {
  return {
    _id: doc._id,
    type: doc.type,
    feedbackTag: doc.feedbackTag,
    title: doc.title,
    description: doc.description,
    imageUrl: doc.imageUrl || "",
    date: doc.publishedAt || doc.createdAt,
  };
}

/* ──────────────────────────────────────────────
   ADMIN
   ────────────────────────────────────────────── */

/**
 * GET /api/admin/whats-new
 * All entries (drafts + published), newest first.
 */
exports.listAdmin = async (_req, res, next) => {
  try {
    const entries = await WhatsNew.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, entries });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/whats-new
 * Multipart. Fields: type, feedbackTag, title, description, status.
 * Optional file field: image.
 */
exports.createPost = async (req, res, next) => {
  try {
    const { type, title, description, status } = req.body;

    if (!VALID_TYPES.includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid update type" });
    }
    if (!title || !title.trim() || !description || !description.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Title and description are required" });
    }

    const isPublished = status === "published";
    const publishedAt = isPublished
      ? parsePublishDate(req.body.publishedAt) || new Date()
      : null;

    const entry = await WhatsNew.create({
      type,
      feedbackTag: toBool(req.body.feedbackTag),
      title: title.trim(),
      description,
      imageUrl: req.file?.path || "",
      imagePublicId: req.file?.filename || "",
      status: isPublished ? "published" : "draft",
      publishedAt,
      publishedMarkerAt: isPublished ? new Date() : null,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, entry });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/whats-new/:id
 * Multipart. Same fields as create. `removeImage=true` clears the image.
 */
exports.updatePost = async (req, res, next) => {
  try {
    const entry = await WhatsNew.findById(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    const { type, title, description, status } = req.body;

    if (type !== undefined) {
      if (!VALID_TYPES.includes(type)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid update type" });
      }
      entry.type = type;
    }
    if (title !== undefined) {
      if (!title.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Title is required" });
      }
      entry.title = title.trim();
    }
    if (description !== undefined) {
      if (!description.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Description is required" });
      }
      entry.description = description;
    }
    if (req.body.feedbackTag !== undefined) {
      entry.feedbackTag = toBool(req.body.feedbackTag);
    }

    // Image handling: a new upload replaces the old one; removeImage clears it.
    const oldPublicId = entry.imagePublicId;
    if (req.file) {
      entry.imageUrl = req.file.path;
      entry.imagePublicId = req.file.filename;
      if (oldPublicId) {
        cloudinary.uploader.destroy(oldPublicId).catch(() => { });
      }
    } else if (toBool(req.body.removeImage)) {
      entry.imageUrl = "";
      entry.imagePublicId = "";
      if (oldPublicId) {
        cloudinary.uploader.destroy(oldPublicId).catch(() => { });
      }
    }

    const parsedPublishedAt = parsePublishDate(req.body.publishedAt);
    if (status !== undefined) {
      if (status === "published") {
        entry.status = "published";
        if (parsedPublishedAt) {
          entry.publishedAt = parsedPublishedAt;
        }
        // Keep the original publish date stable unless a new one is supplied.
        if (!entry.publishedAt) entry.publishedAt = new Date();
        // Keep first publish marker stable across unpublish/re-publish.
        if (!entry.publishedMarkerAt) entry.publishedMarkerAt = new Date();
      } else {
        entry.status = "draft";
      }
    }

    await entry.save();
    res.json({ success: true, entry });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/whats-new/:id
 */
exports.deletePost = async (req, res, next) => {
  try {
    const entry = await WhatsNew.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }
    if (entry.imagePublicId) {
      cloudinary.uploader.destroy(entry.imagePublicId).catch(() => { });
    }
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    next(err);
  }
};

/* ──────────────────────────────────────────────
   USER (dashboard)
   ────────────────────────────────────────────── */

/**
 * GET /api/whats-new
 * Published entries only, newest first.
 */
exports.listPublished = async (_req, res, next) => {
  try {
    const docs = await WhatsNew.find({ status: "published" })
      .sort({ publishedAt: -1 })
      .lean();
    res.json({ success: true, entries: docs.map(publicEntry) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/whats-new/unread
 * { hasUnread } — true if a published entry is newer than whatsNewSeenAt.
 */
exports.getUnread = async (req, res, next) => {
  try {
    const docs = await WhatsNew.find({ status: "published" })
      .select("publishedMarkerAt publishedAt createdAt")
      .lean();

    const latestPublishedTs = docs.reduce((latest, doc) => {
      const marker = doc?.publishedMarkerAt ? new Date(doc.publishedMarkerAt).getTime() : 0;
      const published = doc?.publishedAt ? new Date(doc.publishedAt).getTime() : 0;
      const created = doc?.createdAt ? new Date(doc.createdAt).getTime() : 0;
      const candidate = Math.max(marker, published, created);
      return candidate > latest ? candidate : latest;
    }, 0);

    if (!latestPublishedTs) {
      return res.json({ success: true, hasUnread: false });
    }

    const seenAt = req.user.whatsNewSeenAt;
    const hasUnread = !seenAt || latestPublishedTs > new Date(seenAt).getTime();
    res.json({ success: true, hasUnread });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/whats-new/seen
 * Marks the What's New page as read for the current user.
 */
exports.markSeen = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: { whatsNewSeenAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
