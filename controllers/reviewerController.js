const Reviewer = require("../models/Reviewer");

/**
 * GET /api/reviewers
 * Returns all published reviewers.
 */
exports.getAllReviewers = async (_req, res, next) => {
  try {
    const reviewers = await Reviewer.find({ status: "published" }).sort({ order: 1 });
    res.json({ success: true, count: reviewers.length, data: reviewers });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/reviewers/:id
 * Returns a single reviewer by _id.
 */
exports.getReviewerById = async (req, res, next) => {
  try {
    const reviewer = await Reviewer.findById(req.params.id);
    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Reviewer not found" });
    }
    res.json({ success: true, data: reviewer });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/reviewers/slug/:slug
 * Returns a reviewer by slug.
 */
exports.getReviewerBySlug = async (req, res, next) => {
  try {
    const reviewer = await Reviewer.findOne({ slug: req.params.slug });
    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Reviewer not found" });
    }
    res.json({ success: true, data: reviewer });
  } catch (err) {
    next(err);
  }
};
