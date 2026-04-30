const router = require("express").Router();
const {
  getDashboard,
  generateSprint,
  abandonSprint,
  startSprintTask,
  submitSprintTask,
  saveSprintTaskAnswer,
  getSprintTaskReview,
} = require("../controllers/dashboardController");
const { protect } = require("../middleware/auth");

router.use(protect);

// Full dashboard payload (readiness + breakdown + recommended focus + sprint plan).
router.get("/", getDashboard);

// Sprint plan lifecycle.
router.post("/sprint/generate", generateSprint);
router.delete("/sprint", abandonSprint);

// Sprint task lifecycle.
router.post("/sprint/tasks/:taskId/start", startSprintTask);
router.put("/sprint/tasks/:taskId/answer", saveSprintTaskAnswer);
router.post("/sprint/tasks/:taskId/submit", submitSprintTask);
router.get("/sprint/tasks/:taskId/review", getSprintTaskReview);

module.exports = router;
