/**
 * Seed an admin user with email/password login.
 *
 * Usage:  node seeds/seedAdmin.js
 *
 * Credentials (change in production!):
 *   email:    admin@reviewly.com
 *   password: Admin123!
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📦  Connected to MongoDB");

    const email = "admin@reviewly.com";
    const password = "Admin123!";

    let admin = await User.findOne({ email });

    const passwordHash = await bcrypt.hash(password, 12);

    if (admin) {
      admin.isAdmin = true;
      admin.passwordHash = passwordHash;
      admin.firstName = admin.firstName || "Admin";
      admin.lastName = admin.lastName || "User";
      await admin.save();
      console.log("✅  Admin user updated");
    } else {
      admin = await User.create({
        firstName: "Admin",
        lastName: "User",
        email,
        passwordHash,
        isAdmin: true,
      });
      console.log("✅  Admin user created");
    }

    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   _id:      ${admin._id}`);

    process.exit(0);
  } catch (err) {
    console.error("❌  Seed failed:", err.message);
    process.exit(1);
  }
}

seedAdmin();
