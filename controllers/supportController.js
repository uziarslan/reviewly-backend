const { appendSheetRow, getNextTicketId } = require("../utils/googleSheets");
const { sendSupportNotification } = require("../utils/mailtrap");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client sheet columns: ticket_id, created_at, source, category_raw, category_internal,
// user_email, user_id, plan_type, message, status, replied_at, notes

const PUBLIC_CATEGORY_MAP = {
  "General Inquiry": "general",
  "Pricing & Plans": "pricing",
  "Payments & Subscription": "payment",
  "Feedback or Feature Request": "feedback",
  "Bug or Technical Issue": "bug",
  "Other": "other",
};

const IN_APP_CATEGORY_MAP = {
  "General Inquiry": "general",
  "Pricing & Plans": "pricing",
  "Payments & Subscription": "payment",
  "Feedback or Feature Request": "feedback",
  "Bug or Technical Issue": "bug",
  "Other": "other",
};

function clean(value) {
  const text = String(value || "").trim();
  return text ? text : "";
}

function nowIso() {
  return new Date().toISOString();
}

exports.submitContact = async (req, res, next) => {
  try {
    const { firstName, lastName, email, category, message, company_name } = req.body;

    // Honeypot: if filled, silently succeed without sending
    if (String(company_name || "").trim()) {
      return res.json({ success: true });
    }

    if (!String(firstName || "").trim()) {
      return res.status(400).json({ success: false, message: "First name is required" });
    }
    if (!String(email || "").trim()) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }
    if (!EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: "Email is invalid" });
    }
    if (!String(category || "").trim()) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    if (!String(message || "").trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Reviewly –SupportLog";

    const ticketId = await getNextTicketId({ spreadsheetId, sheetName });
    const createdAt = nowIso();
    const categoryRaw = clean(category);
    const categoryInternal = PUBLIC_CATEGORY_MAP[categoryRaw] || "other";

    const values = [
      ticketId,
      createdAt,
      "public",
      categoryRaw,
      categoryInternal,
      clean(email),
      "", // user_id (public: empty)
      "", // plan_type (public: empty)
      clean(message),
      "new",
      "", // replied_at (manual)
      "", // notes (manual)
    ];

    await appendSheetRow({
      spreadsheetId,
      sheetName,
      values,
    });

    try {
      await sendSupportNotification({
        ticketId,
        createdAt,
        source: "public",
        category: categoryRaw,
        email: clean(email),
        firstName: clean(firstName),
        lastName: clean(lastName),
        userId: "",
        planType: "",
        message: clean(message),
      });
    } catch (emailErr) {
      console.error("Mailtrap support notification failed:", emailErr?.message || emailErr);
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
};

exports.submitHelp = async (req, res, next) => {
  try {
    const { category, message, company_name } = req.body;

    // Honeypot: if filled, silently succeed without sending
    if (String(company_name || "").trim()) {
      return res.json({ success: true });
    }

    if (!String(category || "").trim()) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    if (!String(message || "").trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const user = req.user || {};
    const userEmail = user.email || "";
    const userId = user._id ? String(user._id) : "";
    const planType = user.subscription?.plan || "free";

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Reviewly –SupportLog";

    const ticketId = await getNextTicketId({ spreadsheetId, sheetName });
    const createdAt = nowIso();
    const categoryRaw = clean(category);
    const categoryInternal = IN_APP_CATEGORY_MAP[categoryRaw] || "other";

    const values = [
      ticketId,
      createdAt,
      "in_app",
      categoryRaw,
      categoryInternal,
      userEmail,
      userId,
      planType,
      clean(message),
      "new",
      "", // replied_at (manual)
      "", // notes (manual)
    ];

    await appendSheetRow({
      spreadsheetId,
      sheetName,
      values,
    });

    try {
      await sendSupportNotification({
        ticketId,
        createdAt,
        source: "in_app",
        category: categoryRaw,
        email: userEmail,
        firstName: "",
        lastName: "",
        userId,
        planType,
        message: clean(message),
      });
    } catch (emailErr) {
      console.error("Mailtrap support notification failed:", emailErr?.message || emailErr);
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
};
