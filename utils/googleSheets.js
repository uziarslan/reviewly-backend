const { google } = require("googleapis");
const path = require("path");

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

function getSheetsAuth() {
  const keyFilePath = path.join(__dirname, "..", "config", "google-service-account.json");
  return new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: SHEETS_SCOPE,
  });
}

async function appendSheetRow({ spreadsheetId, sheetName, values }) {
  const auth = getSheetsAuth();
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const sheets = google.sheets({ version: "v4", auth });
  // Wrap sheet name in single quotes if it contains spaces or special characters
  const escapedSheetName = (sheetName || "Sheet1").includes(" ") || (sheetName || "Sheet1").includes("!")
    ? `'${(sheetName || "Sheet1").replace(/'/g, "''")}'`
    : sheetName || "Sheet1";
  const range = `${escapedSheetName}!A1`;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [values],
    },
  });
}

module.exports = { appendSheetRow };
