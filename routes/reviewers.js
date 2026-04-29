const router = require("express").Router();
const {
  getAllReviewers,
  getReviewerById,
  getReviewerBySlug,
} = require("../controllers/reviewerController");

router.get("/", getAllReviewers);
router.get("/slug/:slug", getReviewerBySlug);
router.get("/:id", getReviewerById);

module.exports = router;
