const router = require("express").Router();
const {
  googleLogin,
  googleCodeLogin,
  getMe,
  updateMe,
  logout,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { sessionLimiter } = require("../middleware/rateLimit");

router.post("/google-login", googleLogin);
router.post("/google-code-login", googleCodeLogin);
router.get("/me", protect, sessionLimiter, getMe);
router.put("/me", protect, updateMe);
router.post("/logout", protect, logout);

module.exports = router;
