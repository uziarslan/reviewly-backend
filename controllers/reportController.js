const {
  appendSheetRow,
  ensureSheet,
  getNextSequentialId,
} = require("../utils/googleSheets");

// "reports" sheet columns:
// report_id, created_at, source (exam|review), category, additional_details,
// user_email, user_id, plan_type, reviewer_id, reviewer_title,
// attempt_id, question_index, question_id, question_text,
// selected_answer, correct_answer
const REPORT_HEADERS = [
  "report_id",
  "created_at",
  "source",
  "category",
  "additional_details",
  "user_email",
  "user_id",
  "plan_type",
  "reviewer_id",
  "reviewer_title",
  "attempt_id",
  "question_index",
  "question_id",
  "question_text",
  "selected_answer",
  "correct_answer",
];

const EXAM_CATEGORIES = new Set([
  "Typo/grammar",
  "Question is unclear",
  "Other",
]);

const REVIEW_CATEGORIES = new Set([
  "Wrong answer key",
  "Explanation is incorrect",
  "Typo/grammar",
  "Explanation is unclear",
  "Two choices seem correct",
]);

function clean(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

exports.submitReport = async (req, res, next) => {
  try {
    const {
      source,
      category,
      additionalDetails,
      reviewerId,
      reviewerTitle,
      attemptId,
      questionIndex,
      questionId,
      questionText,
      selectedAnswer,
      correctAnswer,
      company_name,
    } = req.body || {};

    // Honeypot
    if (clean(company_name)) {
      return res.json({ success: true });
    }

    const src = clean(source);
    if (src !== "exam" && src !== "review") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid source" });
    }

    const cat = clean(category);
    const allowed = src === "exam" ? EXAM_CATEGORIES : REVIEW_CATEGORIES;
    if (!allowed.has(cat)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category" });
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEETS_REPORTS_SHEET || "reports";

    await ensureSheet({
      spreadsheetId,
      sheetName,
      headers: REPORT_HEADERS,
    });

    const reportId = await getNextSequentialId({
      spreadsheetId,
      sheetName,
      prefix: "REP",
    });

    const user = req.user || {};
    const userEmail = user.email || "";
    const userId = user._id ? String(user._id) : "";
    const planType = user.subscription?.plan || "free";

    const values = [
      reportId,
      nowIso(),
      src,
      cat,
      clean(additionalDetails),
      userEmail,
      userId,
      planType,
      clean(reviewerId),
      clean(reviewerTitle),
      clean(attemptId),
      questionIndex == null || questionIndex === "" ? "" : String(questionIndex),
      clean(questionId),
      clean(questionText),
      clean(selectedAnswer),
      clean(correctAnswer),
    ];

    await appendSheetRow({
      spreadsheetId,
      sheetName,
      values,
      lastColumnLetter: "P", // 16 columns
    });

    return res.json({ success: true, reportId });
  } catch (err) {
    return next(err);
  }
};
