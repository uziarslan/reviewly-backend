const router = require("express").Router();
const {
  googleLogin,
  googleCodeLogin,
  getMe,
  updateMe,
  logout,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");

router.post("/google-login", googleLogin);
router.post("/google-code-login", googleCodeLogin);
router.get("/me", protect, getMe);
router.put("/me", protect, updateMe);
router.post("/logout", protect, logout);

module.exports = router;
