const router = require("express").Router();
const { protect, admin } = require("../middleware/auth");
const {
  adminLogin,
  getAdminMe,
  getUsers,
  updateUser,
  deleteUser,
} = require("../controllers/adminController");
const {
  getOverview,
  getExamAnalytics,
  getUserAnalytics,
  getRetentionAnalytics,
  getPostHogInsights,
} = require("../controllers/analyticsController");

// ── Public ──
router.post("/login", adminLogin);

// ── Protected (admin only) ──
router.get("/me", protect, admin, getAdminMe);
router.get("/users", protect, admin, getUsers);
router.put("/users/:id", protect, admin, updateUser);
router.delete("/users/:id", protect, admin, deleteUser);

// ── Analytics (admin only) ──
router.get("/analytics/overview", protect, admin, getOverview);
router.get("/analytics/exams", protect, admin, getExamAnalytics);
router.get("/analytics/users", protect, admin, getUserAnalytics);
router.get("/analytics/retention", protect, admin, getRetentionAnalytics);
router.get("/analytics/posthog", protect, admin, getPostHogInsights);

module.exports = router;
