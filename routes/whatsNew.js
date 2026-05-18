const router = require("express").Router();
const { protect } = require("../middleware/auth");
const {
  listPublished,
  getUnread,
  markSeen,
} = require("../controllers/whatsNewController");

router.get("/", protect, listPublished);
router.get("/unread", protect, getUnread);
router.post("/seen", protect, markSeen);

module.exports = router;
