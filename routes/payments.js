const router = require("express").Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../cloudinary");
const { submitPayment } = require("../controllers/paymentController");

const proofStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "reviewly/payment_proofs",
    allowed_formats: ["jpeg", "jpg", "png"],
    resource_type: "image",
    quality: "auto:good",
  },
});

const upload = multer({
  storage: proofStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Proof image must be a JPG or PNG."), false);
    }
  },
});

// Wrap multer so file-type / size errors return a JSON 400 instead of crashing.
function uploadProof(req, res, next) {
  upload.single("proofImage")(req, res, (err) => {
    if (!err) return next();
    const status = err.code === "LIMIT_FILE_SIZE" ? 400 : 400;
    return res.status(status).json({
      success: false,
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "Proof image must be 2 MB or smaller."
          : err.message || "Invalid file.",
    });
  });
}

// Public — the upgrade form on /pricing/upgrade is reachable to anyone with
// an account email; we don't require login at submission time.
router.post("/upgrade", uploadProof, submitPayment);

module.exports = router;
