/**
 * Generate an impersonation JWT for a given user email.
 *
 * Usage:
 *   node scripts/generateImpersonationToken.js <email> [expiresIn]
 *
 * Examples:
 *   node scripts/generateImpersonationToken.js user@example.com
 *   node scripts/generateImpersonationToken.js user@example.com 1h
 *
 * Paste the printed token into the browser devtools to impersonate the user:
 *   localStorage.setItem('reviewly_token', '<token>'); location.reload();
 */

require("dotenv").config();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const connectDB = require("../config/db");
const User = require("../models/User");

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const expiresIn = process.argv[3] || "1h";

  if (!email) {
    console.error("Error: email argument is required.");
    console.error("Usage: node scripts/generateImpersonationToken.js <email> [expiresIn]");
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    console.error("Error: JWT_SECRET is not set in environment.");
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI is not set in environment.");
    process.exit(1);
  }

  try {
    await connectDB();

    const user = await User.findOne({
      email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    }).select("_id email name");

    if (!user) {
      console.error(`No user found with email: ${email}`);
      process.exit(2);
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn });

    console.log("\n=== Impersonation token generated ===");
    console.log(`User:      ${user.name || "(no name)"} <${user.email}>`);
    console.log(`User ID:   ${user._id}`);
    console.log(`Expires:   ${expiresIn}`);
    console.log("\nToken:");
    console.log(token);
    console.log("\nPaste into browser devtools console (on the app origin):");
    console.log(`  localStorage.setItem('reviewly_token', '${token}'); location.reload();`);
    console.log("\nRemember to log out (or clear localStorage) when finished.\n");
  } catch (err) {
    console.error("Failed to generate token:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main();
