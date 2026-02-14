/**
 * One-off migration to drop the deprecated `questionId` field from all questions
 * and remove its unique index. After this, only MongoDB's default `_id` is used.
 *
 * Usage (from backend folder):
 *   node scripts/removeQuestionIdField.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Question = require("../models/Question");

async function run() {
  await connectDB();

  try {
    // Unset the questionId field on all documents where it exists
    const unsetResult = await Question.updateMany(
      { questionId: { $exists: true } },
      { $unset: { questionId: "" } }
    );
    const modified =
      unsetResult.modifiedCount !== undefined
        ? unsetResult.modifiedCount
        : unsetResult.nModified || 0;
    console.log(`✅ Unset questionId on ${modified} documents`);

    // Drop any index on questionId if it exists
    try {
      const indexes = await Question.collection.indexes();
      const idx = indexes.find(
        (i) => i.key && Object.prototype.hasOwnProperty.call(i.key, "questionId")
      );
      if (idx) {
        await Question.collection.dropIndex(idx.name);
        console.log(`✅ Dropped index on questionId (${idx.name})`);
      } else {
        console.log("ℹ️  No index on questionId found to drop");
      }
    } catch (idxErr) {
      console.error("⚠️  Error while checking/dropping questionId index:", idxErr.message);
    }
  } catch (err) {
    console.error("❌  Migration failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run().then(() => {
  console.log("✅ Migration complete.");
  process.exit(0);
});

