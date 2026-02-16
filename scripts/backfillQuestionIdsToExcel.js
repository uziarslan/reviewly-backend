/**
 * Fetches each question's MongoDB _id from the database and writes it into
 * the Excel sheet under the question_id column, matching rows by content.
 *
 * Usage (from backend folder):
 *   node scripts/backfillQuestionIdsToExcel.js
 *
 * Excel path: backend/seeds/data/questions.xlsx
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const connectDB = require("../config/db");
const Question = require("../models/Question");

const EXCEL_PATH = path.join(__dirname, "..", "seeds", "data", "questions.xlsx");

function normalizeHeader(h) {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Normalize string for matching (trim, collapse spaces). */
function norm(s) {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");
}

/** Build a stable key from row array for matching (question_text + choice_a + correct_answer). */
function rowKey(row, idxQText, idxChoiceA, idxCorrect) {
  const a = norm(row[idxQText]);
  const b = norm(row[idxChoiceA]);
  const c = norm(row[idxCorrect]);
  return `${a}|${b}|${c}`;
}

async function run() {
  await connectDB();

  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_PATH);
  } catch (err) {
    console.error("❌ Could not read Excel file at", EXCEL_PATH);
    console.error(err.message);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) {
    console.error("❌ No data rows in sheet.");
    process.exit(1);
  }

  const rawHeaders = rows[0];
  const headerKeys = rawHeaders.map((h) => normalizeHeader(h));

  const questionIdCol = headerKeys.indexOf("question_id");
  const questionTextCol = headerKeys.indexOf("question_text");
  const choiceACol = headerKeys.indexOf("choice_a");
  const correctAnswerCol = headerKeys.indexOf("correct_answer");

  if (questionIdCol === -1) {
    console.error("❌ No 'question_id' column found in the sheet.");
    process.exit(1);
  }
  if (questionTextCol === -1) {
    console.error("❌ No 'question_text' column found.");
    process.exit(1);
  }

  const questions = await Question.find({}).lean();
  console.log(`📄 Excel: ${rows.length - 1} data rows, 📊 DB: ${questions.length} questions`);

  const dbKeyToQuestion = new Map();
  const dbByQuestionTextOnly = new Map(); // fallback: questionText -> [questions]
  for (const q of questions) {
    const key = `${norm(q.questionText)}|${norm(q.choiceA)}|${norm(q.correctAnswer)}`;
    if (!dbKeyToQuestion.has(key)) dbKeyToQuestion.set(key, q);
    const t = norm(q.questionText);
    if (!dbByQuestionTextOnly.has(t)) dbByQuestionTextOnly.set(t, []);
    dbByQuestionTextOnly.get(t).push(q);
  }

  let updated = 0;
  const unmatchedRowIndexes = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const key = rowKey(row, questionTextCol, choiceACol, correctAnswerCol);
    let question = dbKeyToQuestion.get(key);
    if (!question) {
      const textKey = norm(row[questionTextCol]);
      const byText = dbByQuestionTextOnly.get(textKey);
      if (byText && byText.length === 1) question = byText[0];
      else if (byText && byText.length > 1) question = byText[0]; // duplicate content, use first
    }
    if (question) {
      const idStr = question._id.toString();
      if (row[questionIdCol] !== idStr) {
        row[questionIdCol] = idStr;
        updated++;
      }
    } else {
      unmatchedRowIndexes.push(i + 1);
    }
  }

  if (unmatchedRowIndexes.length > 0) {
    console.warn(`⚠️ ${unmatchedRowIndexes.length} Excel row(s) had no matching question in DB (e.g. rows: ${unmatchedRowIndexes.slice(0, 5).join(", ")}${unmatchedRowIndexes.length > 5 ? "..." : ""}).`);
  }

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  workbook.Sheets[sheetName] = newSheet;
  XLSX.writeFile(workbook, EXCEL_PATH);

  console.log(`✅ Wrote MongoDB _id into question_id column for ${updated} row(s). File saved: ${EXCEL_PATH}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
