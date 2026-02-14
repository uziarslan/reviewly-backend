/**
 * Seed questions from an Excel (.xlsx) file into the database.
 *
 * Usage:
 *   npm run seed:questions
 *
 * Place your Excel file at:  backend/seeds/data/questions.xlsx
 *
 * Expected columns (headers in row 1):
 *   question_id | exam_family | exam_level | section | module | topic |
 *   difficulty  | question_text | choice_a | choice_b | choice_c | choice_d |
 *   correct_answer | explanation_correct | explanation_wrong | reviewly_tip |
 *   status | batch_id | source | created_at | note - gemini validation
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const connectDB = require("../config/db");
const Question = require("../models/Question");

const EXCEL_PATH = path.join(__dirname, "data", "questions.xlsx");

/** Normalise a header string to a consistent key. */
function normalizeHeader(h) {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")   // non-alphanumeric → _
    .replace(/_+/g, "_")           // collapse multiple _
    .replace(/^_|_$/g, "");        // trim leading/trailing _
}

/** Map normalised header → Question model field. */
const HEADER_MAP = {
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
  created_at: "createdAt",        // ignored (Mongoose handles timestamps)
  note_gemini_validation: "note",
};

/** Build a question doc from a row object (keys = Excel header strings). */
function parseRowFromObject(rowObj) {
  if (!rowObj || typeof rowObj !== "object") return {};
  const doc = {};
  for (const [excelKey, val] of Object.entries(rowObj)) {
    const key = normalizeHeader(excelKey);
    const field = HEADER_MAP[key];
    if (!field || field === "createdAt") continue;
    let s = val === undefined || val === null ? "" : String(val).trim();
    doc[field] = s;
  }

  // Normalise specific fields
  if (doc.examFamily) doc.examFamily = doc.examFamily.toLowerCase();
  if (doc.examLevel) doc.examLevel = doc.examLevel.toLowerCase();
  if (doc.section) doc.section = doc.section.toLowerCase();
  if (doc.difficulty) doc.difficulty = doc.difficulty.toLowerCase();
  if (doc.correctAnswer) doc.correctAnswer = doc.correctAnswer.toUpperCase();
  if (doc.status) doc.status = doc.status.toLowerCase();

  return doc;
}

async function seed() {
  await connectDB();

  // Read Excel
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_PATH);
  } catch (err) {
    console.error(`❌  Could not read Excel file at ${EXCEL_PATH}`);
    console.error("   Make sure to place your questions.xlsx in backend/seeds/data/");
    console.error(err.message);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Use object mode so keys = header names from row 1 (robust to column order/spelling)
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  if (rawRows.length === 0) {
    console.error("❌  Excel file has no data rows.");
    process.exit(1);
  }

  const headerKeys = Object.keys(rawRows[0] || {}).map((h) => normalizeHeader(h));
  console.log(`📄  Detected ${rawRows.length} data rows in sheet "${sheetName}"`);
  console.log(`📋  Headers: ${headerKeys.join(", ")}\n`);

  // Parse data rows (each row is an object keyed by Excel header text)
  const docs = [];
  let skipped = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const doc = parseRowFromObject(rawRows[i]);
    if (!doc.questionText) {
      skipped++;
      continue;
    }
    docs.push(doc);
  }

  console.log(`✅  Parsed ${docs.length} questions (skipped ${skipped} empty rows)`);

  // Clear existing & insert
  console.log("🗑  Clearing existing questions...");
  await Question.deleteMany({});

  console.log("📝  Inserting questions...");
  const result = await Question.insertMany(docs, { ordered: false });
  console.log(`✅  ${result.length} questions seeded successfully!`);

  // Stats
  const stats = {};
  docs.forEach((d) => {
    const key = `${d.section} (${d.difficulty})`;
    stats[key] = (stats[key] || 0) + 1;
  });
  console.log("\n📊  Distribution:");
  Object.entries(stats)
    .sort()
    .forEach(([k, v]) => console.log(`   ${k}: ${v}`));

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌  Seeding failed:", err);
  process.exit(1);
});
