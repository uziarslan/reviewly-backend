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

async function getSpreadsheetMeta({ spreadsheetId, auth }) {
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  return { sheetsApi: sheets, meta: meta.data };
}

async function ensureSheet({ spreadsheetId, sheetName, headers = [] }) {
  const auth = getSheetsAuth();
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const { sheetsApi } = await getSpreadsheetMeta({ spreadsheetId, auth });
  const escapedSheetName = escapeSheetName(sheetName || "Sheet1");

  let row1 = [];
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapedSheetName}!1:1`,
    });
    row1 = res.data.values?.[0] || [];
  } catch (err) {
    const isMissingSheet =
      err?.response?.data?.error?.status === "INVALID_ARGUMENT" &&
      /Unable to parse range/i.test(err.message || "");

    if (!isMissingSheet) {
      throw err;
    }

    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName || "Sheet1",
              },
            },
          },
        ],
      },
    });
  }

  if (headers.length && row1.length === 0) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapedSheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [headers],
      },
    });
  }
}

/**
 * Get the next sequential ID (e.g. SUP-0001, PAY-0001) by reading column A
 * of an existing sheet and finding the highest matching prefix.
 */
async function getNextSequentialId({ spreadsheetId, sheetName, prefix }) {
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
  const pat = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let maxNum = 0;

  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i][0] || "").trim();
    const m = cell.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(4, "0")}`;
}

/**
 * Backwards-compatible alias for the support flow (SUP-0001…).
 */
async function getNextTicketId({ spreadsheetId, sheetName }) {
  return getNextSequentialId({ spreadsheetId, sheetName, prefix: "SUP" });
}

/**
 * Parse row number (1-based) from A1 range like "Sheet1!A2:L2" or "'Sheet'!A2:L2"
 */
function parseRowFromA1Range(a1Range) {
  const match = String(a1Range || "").match(/!([A-Z]+)(\d+)/);
  return match ? parseInt(match[2], 10) : null;
}

async function appendSheetRow({ spreadsheetId, sheetName, values, lastColumnLetter }) {
  const auth = getSheetsAuth();
  if (!spreadsheetId) {
    const err = new Error("Google Sheets spreadsheet ID is not configured");
    err.statusCode = 503;
    throw err;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const escapedSheetName = escapeSheetName(sheetName || "Sheet1");
  // Range tail defaults to "L" (12 columns) for backwards-compat with the
  // support log; callers can override for wider sheets.
  const tailLetter = (lastColumnLetter || "L").toUpperCase();
  const range = `${escapedSheetName}!A1:${tailLetter}`;

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
      // Convert column letter (A..Z) to a 0-based column index for the API
      const endColumnIndex = tailLetter.charCodeAt(0) - "A".charCodeAt(0) + 1;
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
                  endColumnIndex,
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

module.exports = {
  appendSheetRow,
  ensureSheet,
  getNextTicketId,
  getNextSequentialId,
};
