const router = require("express").Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../cloudinary");
const { protect, admin } = require("../middleware/auth");
const {
  adminLogin,
  getAdminMe,
  getUsers,
  updateUser,
  deleteUser,
  getCseExamDate,
  updateCseExamDate,
  getAnnouncement,
  updateAnnouncement,
} = require("../controllers/adminController");
const {
  getOverview,
  getExamAnalytics,
  getUserAnalytics,
  getRetentionAnalytics,
  getPostHogInsights,
} = require("../controllers/analyticsController");
const {
  listAdmin,
  createPost,
  updatePost,
  deletePost,
} = require("../controllers/whatsNewController");

// ── What's New image upload (Cloudinary) ──
const whatsNewStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "reviewly/whats_new",
    allowed_formats: ["jpeg", "jpg", "png"],
    resource_type: "image",
    quality: "auto:good",
  },
});

const whatsNewUpload = multer({
  storage: whatsNewStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Image must be a JPG or PNG."), false);
    }
  },
});

// Wrap multer so file-type / size errors return JSON 400 instead of crashing.
function uploadWhatsNewImage(req, res, next) {
  whatsNewUpload.single("image")(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({
      success: false,
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "Image must be 5 MB or smaller."
          : err.message || "Invalid file.",
    });
  });
}

// ── Public ──
router.post("/login", adminLogin);

// ── Protected (admin only) ──
router.get("/me", protect, admin, getAdminMe);
router.get("/users", protect, admin, getUsers);
router.put("/users/:id", protect, admin, updateUser);
router.delete("/users/:id", protect, admin, deleteUser);

// ── App settings (admin only) ──
router.get("/settings/exam-date", protect, admin, getCseExamDate);
router.put("/settings/exam-date", protect, admin, updateCseExamDate);
router.get("/settings/announcement", protect, admin, getAnnouncement);
router.put("/settings/announcement", protect, admin, updateAnnouncement);

// ── What's New (admin only) ──
router.get("/whats-new", protect, admin, listAdmin);
router.post("/whats-new", protect, admin, uploadWhatsNewImage, createPost);
router.put("/whats-new/:id", protect, admin, uploadWhatsNewImage, updatePost);
router.delete("/whats-new/:id", protect, admin, deletePost);

// ── Analytics (admin only) ──
router.get("/analytics/overview", protect, admin, getOverview);
router.get("/analytics/exams", protect, admin, getExamAnalytics);
router.get("/analytics/users", protect, admin, getUserAnalytics);
router.get("/analytics/retention", protect, admin, getRetentionAnalytics);
router.get("/analytics/posthog", protect, admin, getPostHogInsights);

module.exports = router;
