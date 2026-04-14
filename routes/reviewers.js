const router = require("express").Router();
const {
  getAllReviewers,
  getReviewerById,
} = require("../controllers/reviewerController");

router.get("/", getAllReviewers);
router.get("/:id", getReviewerById);

module.exports = router;
