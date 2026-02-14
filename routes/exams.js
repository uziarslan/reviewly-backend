const router = require("express").Router();
const {
  startExam,
  saveAnswer,
  pauseExam,
  submitExam,
  getAttemptResult,
  getAttemptReview,
  getUserAttempts,
  getReviewerProgress,
} = require("../controllers/examController");
const { protect } = require("../middleware/auth");

// Start an exam (generate attempt)
router.post("/:reviewerId/start", protect, startExam);

// Attempt operations
router.get("/attempts/user/history", protect, getUserAttempts);
router.get("/attempts/user/progress/:reviewerId", protect, getReviewerProgress);
router.get("/attempts/:attemptId", protect, getAttemptResult);
router.get("/attempts/:attemptId/review", protect, getAttemptReview);
router.put("/attempts/:attemptId/answer", protect, saveAnswer);
router.put("/attempts/:attemptId/pause", protect, pauseExam);
router.post("/attempts/:attemptId/submit", protect, submitExam);

module.exports = router;
