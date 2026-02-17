const { google } = require("googleapis");
const path = require("path");

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getSheetsAuth() {
  let authConfig;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    authConfig = { credentials: creds };
  } else {
    authConfig = { keyFile: path.join(__dirname, "..", "config", "google-service-account.json") };
  }

  return new google.auth.GoogleAuth({
    ...authConfig,
    scopes: SHEETS_SCOPE,
  });
}

/**
 * Get sheet data from Google Sheets
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {string} sheetName - Sheet name
 * @returns {Promise<Array>} Array of objects with headers as keys
 */
async function getSheetData({ spreadsheetId, sheetName }) {
  const auth = getSheetsAuth();
  
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const sheets = google.sheets({ version: "v4", auth });
  
  // Wrap sheet name in single quotes if it contains spaces
  const escapedSheetName = (sheetName || "Sheet1").includes(" ")
    ? `'${(sheetName || "Sheet1").replace(/'/g, "''")}'`
    : sheetName || "Sheet1";
  
  const range = `${escapedSheetName}`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) {
    return [];
  }

  // First row is headers
  const headers = rows[0];
  console.log(`📋 Sheet headers:`, headers);
  
  // Convert rows to objects
  const data = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      // Normalize: lowercase, strip non-alphanumeric (except _), collapse underscores
      const key = header
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      obj[key] = row[index] || "";
    });
    return obj;
  });

  console.log(`💾 Converted ${data.length} rows from sheet (sample first row):`, JSON.stringify(data[0], null, 2));

  return data;
}

module.exports = { getSheetData };
