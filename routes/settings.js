const router = require("express").Router();
const { getAnnouncement } = require("../controllers/adminController");

// Public — no auth required
router.get("/announcement", getAnnouncement);

module.exports = router;
