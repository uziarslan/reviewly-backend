const User = require("../models/User");

/**
 * GET /api/library
 * Returns the current user's bookmarked reviewer IDs (populated).
 */
exports.getLibrary = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "library",
      match: { status: "published" },
    });
    res.json({ success: true, data: user.library });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/library/:reviewerId
 * Add a reviewer to user's library (bookmark).
 */
exports.addToLibrary = async (req, res, next) => {
  try {
    const { reviewerId } = req.params;
    const user = await User.findById(req.user._id);

    if (user.library.includes(reviewerId)) {
      return res.json({ success: true, message: "Already bookmarked", data: user.library });
    }

    user.library.push(reviewerId);
    await user.save();

    res.json({ success: true, message: "Added to library", data: user.library });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/library/:reviewerId
 * Remove a reviewer from user's library.
 */
exports.removeFromLibrary = async (req, res, next) => {
  try {
    const { reviewerId } = req.params;
    const user = await User.findById(req.user._id);

    user.library = user.library.filter(
      (id) => id.toString() !== reviewerId
    );
    await user.save();

    res.json({ success: true, message: "Removed from library", data: user.library });
  } catch (err) {
    next(err);
  }
};
