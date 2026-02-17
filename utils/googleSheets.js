const { google } = require("googleapis");
const path = require("path");

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

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

function escapeSheetName(name) {
  const n = name || "Sheet1";
  // Wrap in single quotes if contains spaces, hyphens, or special chars
  const needsQuotes = /[\s\-–!'"]/.test(n);
  return needsQuotes ? `'${n.replace(/'/g, "''")}'` : n;
}

/**
 * Get the next ticket ID (SUP-0001, SUP-0002, ...) by reading existing rows.
 */
async function getNextTicketId({ spreadsheetId, sheetName }) {
  const auth = getSheetsAuth();
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const escaped = escapeSheetName(sheetName || "Sheet1");
  const range = `${escaped}!A:A`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
  let maxNum = 0;
  const pattern = /^SUP-(\d+)$/i;

  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i][0] || "").trim();
    const m = cell.match(pattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  return `SUP-${String(maxNum + 1).padStart(4, "0")}`;
}

/**
 * Parse row number (1-based) from A1 range like "Sheet1!A2:L2" or "'Sheet'!A2:L2"
 */
function parseRowFromA1Range(a1Range) {
  const match = String(a1Range || "").match(/!([A-Z]+)(\d+)/);
  return match ? parseInt(match[2], 10) : null;
}

async function appendSheetRow({ spreadsheetId, sheetName, values }) {
  const auth = getSheetsAuth();
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const escapedSheetName = escapeSheetName(sheetName || "Sheet1");
  const range = `${escapedSheetName}!A1:L`;

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [values],
    },
  });

  // Clear inherited formatting (e.g. purple header) so the new row has plain white background
  const updatedRange = appendRes.data?.updates?.updatedRange;
  const row1Based = updatedRange ? parseRowFromA1Range(updatedRange) : null;

  if (row1Based != null) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    });
    const sheet = (meta.data.sheets || []).find(
      (s) => (s.properties?.title || "") === (sheetName || "Sheet1")
    );
    const sheetId = sheet?.properties?.sheetId;

    if (sheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: row1Based - 1,
                  endRowIndex: row1Based,
                  startColumnIndex: 0,
                  endColumnIndex: 12,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1 },
                  },
                },
                fields: "userEnteredFormat.backgroundColor",
              },
            },
          ],
        },
      });
    }
  }
}

module.exports = { appendSheetRow, getNextTicketId };
