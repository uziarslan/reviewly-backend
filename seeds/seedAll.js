/**
 * Run all seeders in sequence.
 * Usage:  npm run seed:all
 */
require("dotenv").config();

async function runAll() {
  console.log("═══════════════════════════════════════════");
  console.log("  SEEDING REVIEWERS");
  console.log("═══════════════════════════════════════════\n");

  // We can't simply require the seed files because they call process.exit().
  // Instead run them as child processes.
  const { execSync } = require("child_process");

  try {
    execSync("node seeds/seedReviewers.js", { cwd: __dirname + "/..", stdio: "inherit" });
  } catch {
    console.error("Reviewer seeding failed");
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  SEEDING QUESTIONS");
  console.log("═══════════════════════════════════════════\n");

  try {
    execSync("node seeds/seedQuestions.js", { cwd: __dirname + "/..", stdio: "inherit" });
  } catch {
    console.error("Question seeding failed");
    process.exit(1);
  }

  console.log("\n✅  All seeds completed!\n");
}

runAll();
