const router = require("express").Router();
const { submitContact, submitHelp } = require("../controllers/supportController");
const { protect } = require("../middleware/auth");

router.post("/contact", submitContact);
router.post("/help", protect, submitHelp);

module.exports = router;
