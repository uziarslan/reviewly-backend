require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

async function testAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");
    
    const admin = await User.findOne({ email: "admin@reviewly.com" });
    if (!admin) {
      console.log("❌ Admin user not found!");
      process.exit(1);
    }
    
    console.log("✅ Admin user found:");
    console.log("   Email:", admin.email);
    console.log("   isAdmin:", admin.isAdmin);
    console.log("   Has passwordHash:", !!admin.passwordHash);
    console.log("   passwordHash:", admin.passwordHash ? admin.passwordHash.substring(0, 20) + "..." : "MISSING");
    
    // Test password verification
    const bcrypt = require("bcryptjs");
    const isMatch = await bcrypt.compare("Password123!)", admin.passwordHash);
    console.log("   Password matches 'Password123!)':", isMatch);
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

testAdmin();
