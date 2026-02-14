const router = require("express").Router();
const {
  getLibrary,
  addToLibrary,
  removeFromLibrary,
} = require("../controllers/libraryController");
const { protect } = require("../middleware/auth");

router.get("/", protect, getLibrary);
router.post("/:reviewerId", protect, addToLibrary);
router.delete("/:reviewerId", protect, removeFromLibrary);

module.exports = router;
