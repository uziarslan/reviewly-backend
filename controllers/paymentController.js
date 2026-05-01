const logger = require("../utils/logger");
const {
  appendSheetRow,
  ensureSheet,
  getNextSequentialId,
} = require("../utils/googleSheets");
const {
  sendPaymentRequestAdminAlert,
  sendPaymentReceivedEmail,
} = require("../utils/mailtrap");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAYMENTS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_PAYMENTS_SHEET_NAME || "Reviewly –Payments";
const PAYMENT_HEADERS = [
  "payment_id",
  "created_at",
  "source",
  "user_email",
  "gcash_ref",
  "gcash_name",
  "proof_image_url",
  "amount",
  "currency",
  "status",
  "processed_at",
  "notes",
];

function clean(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * POST /api/payments/upgrade   (public — no auth required)
 * Multipart form-data: email, gcashRef, gcashName, proofImage (file, optional)
 *
 * The multer + CloudinaryStorage middleware in routes/payments.js handles the
 * file upload before this controller runs.  If a file was attached it is
 * available as req.file; its Cloudinary secure URL is at req.file.path.
 *
 * Records a manual GCash payment confirmation by:
 *   1. Reading the Cloudinary URL from req.file (uploaded by middleware).
 *   2. Appending a row to the client's Google Sheet (Payments tab).
 *   3. Emailing the admin team and the user via Mailtrap.
 */
exports.submitPayment = async (req, res, next) => {
  try {
    const { email, gcashRef, gcashName } = req.body || {};

    if (!clean(email) || !EMAIL_REGEX.test(clean(email))) {
      return res
        .status(400)
        .json({ success: false, message: "A valid email is required." });
    }
    if (!clean(gcashRef)) {
      return res
        .status(400)
        .json({ success: false, message: "GCash reference number is required." });
    }
    if (!clean(gcashName)) {
      return res
        .status(400)
        .json({ success: false, message: "GCash account name is required." });
    }

    // req.file is populated by multer+CloudinaryStorage if a file was uploaded.
    // req.file.path contains the Cloudinary secure URL.
    const proofImageUrl = req.file ? req.file.path : "";

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const normalizedEmail = clean(email).toLowerCase();
    const cleanedRef = clean(gcashRef);
    const cleanedName = clean(gcashName);
    const createdAt = nowIso();

    // Sheet columns (12, A:L):
    //   payment_id, created_at, source, user_email, gcash_ref, gcash_name,
    //   proof_image_url, amount, currency, status, processed_at, notes
    let paymentId = "";
    try {
      await ensureSheet({
        spreadsheetId,
        sheetName: PAYMENTS_SHEET_NAME,
        headers: PAYMENT_HEADERS,
      });

      paymentId = await getNextSequentialId({
        spreadsheetId,
        sheetName: PAYMENTS_SHEET_NAME,
        prefix: "PAY",
      });

      const values = [
        paymentId,
        createdAt,
        "public",
        normalizedEmail,
        cleanedRef,
        cleanedName,
        proofImageUrl,
        349,
        "PHP",
        "new",
        "", // processed_at (manual)
        "", // notes (manual)
      ];

      await appendSheetRow({
        spreadsheetId,
        sheetName: PAYMENTS_SHEET_NAME,
        values,
      });
    } catch (sheetErr) {
      logger.error(
        { err: sheetErr },
        "Failed to append payment row to Google Sheets"
      );
      return res.status(502).json({
        success: false,
        message:
          "We couldn't record your payment. Please try again or contact support@reviewly.ph.",
      });
    }

    // Fire-and-forget admin alert + user receipt. Never block the response.
    Promise.all([
      sendPaymentRequestAdminAlert({
        paymentId,
        createdAt,
        email: normalizedEmail,
        gcashRef: cleanedRef,
        gcashName: cleanedName,
        proofImageUrl,
      }).catch((err) =>
        logger.error({ err }, "Failed to send admin payment alert")
      ),
      sendPaymentReceivedEmail({
        to: normalizedEmail,
        gcashRef: cleanedRef,
      }).catch((err) =>
        logger.error({ err }, "Failed to send user payment receipt")
      ),
    ]);

    res.status(201).json({
      success: true,
      message: "Payment confirmation received. We'll verify it within 1–6 hours.",
      data: { paymentId },
    });
  } catch (err) {
    next(err);
  }
};
