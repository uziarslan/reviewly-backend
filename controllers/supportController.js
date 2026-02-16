const { appendSheetRow } = require("../utils/googleSheets");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
  const text = String(value || "").trim();
  return text ? text : "-";
}

function nowIso() {
  return new Date().toISOString();
}

exports.submitContact = async (req, res, next) => {
  try {
    const { firstName, lastName, email, category, message } = req.body;

    if (!String(firstName || "").trim()) {
      return res.status(400).json({ success: false, message: "First name is required" });
    }
    if (!String(lastName || "").trim()) {
      return res.status(400).json({ success: false, message: "Last name is required" });
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

    await appendSheetRow({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME,
      values: [
        nowIso(),
        "/contact",
        clean(firstName),
        clean(lastName),
        clean(email),
        clean(category),
        clean(message),
        "-",
      ],
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
};

exports.submitHelp = async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!String(message || "").trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const user = req.user || {};

    await appendSheetRow({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME,
      values: [
        nowIso(),
        "/dashboard/help",
        clean(user.firstName),
        clean(user.lastName),
        clean(user.email),
        "-",
        clean(message),
        clean(user._id),
      ],
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
};
