const router = require("express").Router();
const {
  getTrialStatus,
  getTrialReviewers,
  skipTrial,
  startTrialExam,
  submitTrialExam,
  abandonTrialExam,
  getTrialResult,
} = require("../controllers/trialAssessmentController");
const { protect } = require("../middleware/auth");
const { saveAnswer, pauseExam, beaconSave } = require("../controllers/examController");

// Beacon save (no auth — token in body)
router.post("/attempts/:attemptId/beacon", beaconSave);

// All remaining routes require auth
router.use(protect);

// Trial assessment status & reviewers
router.get("/status", getTrialStatus);
router.get("/reviewers", getTrialReviewers);

// Skip trial
router.post("/skip", skipTrial);

// Start trial exam
router.post("/:reviewerId/start", startTrialExam);

// Reuse existing exam operations for answer saving / pausing
router.put("/attempts/:attemptId/answer", saveAnswer);
router.put("/attempts/:attemptId/pause", pauseExam);

// Submit & abandon
router.post("/attempts/:attemptId/submit", submitTrialExam);
router.post("/attempts/:attemptId/abandon", abandonTrialExam);

// Get result after submission
router.get("/attempts/:attemptId/result", getTrialResult);

module.exports = router;
