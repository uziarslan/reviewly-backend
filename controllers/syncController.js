const { getSheetData } = require("../utils/googleSheetsReader");
const Question = require("../models/Question");

/**
 * Map Google Sheets column names to DB field names
 */
const COLUMN_MAPPING = {
  question_id: "_id",
  exam_family: "examFamily",
  exam_level: "examLevel",
  section: "section",
  module: "module",
  topic: "topic",
  difficulty: "difficulty",
  question_text: "questionText",
  choice_a: "choiceA",
  choice_b: "choiceB",
  choice_c: "choiceC",
  choice_d: "choiceD",
  correct_answer: "correctAnswer",
  explanation_correct: "explanationCorrect",
  explanation_wrong: "explanationWrong",
  reviewly_tip: "reviewlyTip",
  status: "status",
  batch_id: "batchId",
  source: "source",
  note_gemini_validation: "note",
};

/**
 * Convert sheet row to DB format (only include non-empty fields)
 */
function convertSheetRowToDBFormat(sheetRow) {
  const dbRow = {};
  
  Object.entries(COLUMN_MAPPING).forEach(([sheetKey, dbKey]) => {
    const value = sheetRow[sheetKey];
    // Only include fields that have actual values (not empty strings)
    if (value !== undefined && value !== "" && String(value).trim() !== "") {
      dbRow[dbKey] = value;
    }
  });

  return dbRow;
}

/**
 * Check if two objects have differences (compare converted DB-keyed data against DB doc)
 */
function hasChanges(convertedData, dbData) {
  for (const [dbKey, sheetVal] of Object.entries(convertedData)) {
    if (dbKey === "_id") continue;

    const sheetValue = String(sheetVal || "").trim();
    const dbValue = String(dbData[dbKey] || "").trim();

    if (sheetValue !== dbValue) {
      return true;
    }
  }

  return false;
}

/**
 * Sync questions from Google Sheets to MongoDB
 */
async function syncQuestionsFromSheet(sheetConfig) {
  try {
    console.log("🔄 Starting question sync from Google Sheets...");

    if (!sheetConfig.spreadsheetId || !sheetConfig.sheetName) {
      throw new Error(
        "Google Sheets config missing: GOOGLE_SHEETS_QUESTIONS_ID or GOOGLE_SHEETS_QUESTIONS_SHEET"
      );
    }

    // Fetch data from Google Sheets
    const sheetData = await getSheetData({
      spreadsheetId: sheetConfig.spreadsheetId,
      sheetName: sheetConfig.sheetName,
    });

    console.log(`📊 Fetched ${sheetData.length} questions from Google Sheets`);

    if (sheetData.length === 0) {
      console.log("⚠️  No data found in Google Sheets");
      return { synced: 0, updated: 0, failed: 0 };
    }

    let updated = 0;
    let failed = 0;

    for (const sheetRow of sheetData) {
      try {
        if (!sheetRow.question_id) {
          console.warn("⚠️  Skipping row with missing question_id");
          failed++;
          continue;
        }

        const questionId = sheetRow.question_id;
        const convertedData = convertSheetRowToDBFormat(sheetRow);

        // Find existing question
        const existingQuestion = await Question.findById(questionId);

        if (!existingQuestion) {
          console.log(`ℹ️  Question ${questionId} not found in DB (skipping)`);
          continue;
        }

        // Check if there are changes
        if (hasChanges(convertedData, existingQuestion)) {
          console.log(`\n📝 Changes detected for question ${questionId}:`);
          
          // Log what changed
          Object.entries(convertedData).forEach(([key, value]) => {
            const dbValue = existingQuestion[key];
            if (String(value).trim() !== String(dbValue || "").trim()) {
              console.log(`   ${key}: "${dbValue}" → "${value}"`);
            }
          });

          await Question.findByIdAndUpdate(questionId, convertedData, { new: true });
          console.log(`✅ Updated question ${questionId}`);
          updated++;
        } else {
          console.log(`⏭️  No changes for question ${questionId}`);
        }
      } catch (err) {
        console.error(`❌ Error syncing question ${sheetRow.question_id}:`, err.message);
        failed++;
      }
    }

    const totalProcessed = updated + failed;
    console.log(
      `\n📈 Sync complete: ${updated} updated, ${failed} failed out of ${totalProcessed} processed`
    );

    return {
      synced: sheetData.length,
      updated,
      failed,
    };
  } catch (err) {
    console.error("❌ Error syncing questions from Google Sheets:", err.message);
    throw err;
  }
}

module.exports = { syncQuestionsFromSheet };
