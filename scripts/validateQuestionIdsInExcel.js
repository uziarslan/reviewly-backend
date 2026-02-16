/**
 * Fetches all questions from DB, matches each Excel row to a question by content,
 * and checks if the question_id in Excel matches the MongoDB _id. Reports any
 * rows with wrong or missing IDs.
 *
 * Usage (from backend folder):
 *   node scripts/validateQuestionIdsInExcel.js
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

function norm(s) {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ");
}

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
  const totalExcelRows = rows.length - 1;

  console.log(`\n📄 Excel data rows: ${totalExcelRows}`);
  console.log(`📊 DB questions: ${questions.length}\n`);

  const dbKeyToQuestion = new Map();
  const dbByQuestionTextOnly = new Map();
  for (const q of questions) {
    const key = `${norm(q.questionText)}|${norm(q.choiceA)}|${norm(q.correctAnswer)}`;
    if (!dbKeyToQuestion.has(key)) dbKeyToQuestion.set(key, q);
    const t = norm(q.questionText);
    if (!dbByQuestionTextOnly.has(t)) dbByQuestionTextOnly.set(t, []);
    dbByQuestionTextOnly.get(t).push(q);
  }

  let correct = 0;
  let wrong = 0;
  let missing = 0;
  let noMatch = 0;
  const wrongRows = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const excelRowNum = i + 1;
    const excelId = (row[questionIdCol] ?? "").toString().trim();

    const key = rowKey(row, questionTextCol, choiceACol, correctAnswerCol);
    let question = dbKeyToQuestion.get(key);
    if (!question) {
      const textKey = norm(row[questionTextCol]);
      const byText = dbByQuestionTextOnly.get(textKey);
      if (byText && byText.length >= 1) question = byText[0];
    }

    if (!question) {
      noMatch++;
      wrongRows.push({
        excelRow: excelRowNum,
        excelId: excelId || "(empty)",
        expectedId: "(no matching question in DB)",
        questionText: norm(row[questionTextCol]).slice(0, 60) + "...",
      });
      continue;
    }

    const expectedId = question._id.toString();

    if (!excelId) {
      missing++;
      wrongRows.push({
        excelRow: excelRowNum,
        excelId: "(empty)",
        expectedId,
        questionText: norm(row[questionTextCol]).slice(0, 60) + "...",
      });
      continue;
    }

    if (excelId !== expectedId) {
      wrong++;
      wrongRows.push({
        excelRow: excelRowNum,
        excelId,
        expectedId,
        questionText: norm(row[questionTextCol]).slice(0, 60) + "...",
      });
    } else {
      correct++;
    }
  }

  console.log("--- Result ---");
  console.log(`✅ Correct (Excel question_id matches DB _id): ${correct}`);
  if (wrong > 0) console.log(`❌ Wrong ID in Excel: ${wrong}`);
  if (missing > 0) console.log(`⚠️  Empty question_id in Excel: ${missing}`);
  if (noMatch > 0) console.log(`⚠️  No matching question in DB for row: ${noMatch}`);

  if (wrongRows.length > 0) {
    console.log("\n--- Rows with wrong or missing ID ---");
    wrongRows.forEach((r) => {
      console.log(`  Row ${r.excelRow}: Excel="${r.excelId}" → expected="${r.expectedId}"`);
      console.log(`    "${r.questionText}"`);
    });
  }

  const allGood = wrong === 0 && missing === 0 && noMatch === 0;
  console.log(allGood ? "\n✅ All records have the correct question_id in Excel.\n" : "\n");

  await mongoose.disconnect();
  process.exit(allGood ? 0 : 1);
}

run().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
