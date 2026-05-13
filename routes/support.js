const router = require("express").Router();
const { submitContact, submitHelp } = require("../controllers/supportController");
const { submitReport } = require("../controllers/reportController");
const { protect } = require("../middleware/auth");

router.post("/contact", submitContact);
router.post("/help", protect, submitHelp);
router.post("/report", protect, submitReport);

module.exports = router;
