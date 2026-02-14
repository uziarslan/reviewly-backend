const router = require("express").Router();
const {
  getAttemptResult,
  getAttemptReview,
  getUserAttempts,
} = require("../controllers/examController");
const { protect } = require("../middleware/auth");

router.get("/user/history", protect, getUserAttempts);
router.get("/:attemptId", protect, getAttemptResult);
router.get("/:attemptId/review", protect, getAttemptReview);

module.exports = router;
