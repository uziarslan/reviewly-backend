const router = require("express").Router();
const { protect, admin } = require("../middleware/auth");
const {
  adminLogin,
  getAdminMe,
  getUsers,
  updateUser,
  deleteUser,
} = require("../controllers/adminController");

// ── Public ──
router.post("/login", adminLogin);

// ── Protected (admin only) ──
router.get("/me", protect, admin, getAdminMe);
router.get("/users", protect, admin, getUsers);
router.put("/users/:id", protect, admin, updateUser);
router.delete("/users/:id", protect, admin, deleteUser);

module.exports = router;
