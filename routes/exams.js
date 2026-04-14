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
  beaconSave,
  generateShareLink,
  getSharedResult,
} = require("../controllers/examController");
const { protect } = require("../middleware/auth");

// Public share endpoint (no auth)
router.get("/shared/:shareToken", getSharedResult);

// Start an exam (generate attempt)
router.post("/:reviewerId/start", protect, startExam);

// Attempt operations
router.get("/attempts/user/history", protect, getUserAttempts);
router.get("/attempts/user/progress/:reviewerId", protect, getReviewerProgress);
router.get("/attempts/:attemptId", protect, getAttemptResult);
router.get("/attempts/:attemptId/review", protect, getAttemptReview);
router.put("/attempts/:attemptId/answer", protect, saveAnswer);
router.post("/attempts/:attemptId/beacon", beaconSave);
router.put("/attempts/:attemptId/pause", protect, pauseExam);
router.post("/attempts/:attemptId/submit", protect, submitExam);
router.post("/attempts/:attemptId/share", protect, generateShareLink);

module.exports = router;
