// fix-password.js - Reset SuperAdmin Password
require("dotenv").config();
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "panopticon_chat",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

async function fixSuperAdminPassword() {
  try {
    console.log("🔧 Fixing SuperAdmin password...");

    const password = "SuperAdmin123!";
    const hash = await bcrypt.hash(password, 10);

    console.log("Generated password hash:", hash);

    // Update the password
    const result = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username, email, role",
      [hash, "superadmin"],
    );

    if (result.rows.length === 0) {
      console.log("❌ SuperAdmin user not found!");
      console.log("Creating SuperAdmin user...");

      const createResult = await pool.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role",
        ["superadmin", "superadmin@panopticon.local", hash, "superadmin"],
      );

      console.log("✅ SuperAdmin created:", createResult.rows[0]);
    } else {
      console.log("✅ SuperAdmin password updated successfully");
      console.log("User:", result.rows[0]);
    }

    // Verify the password works
    console.log("\n🧪 Testing password...");
    const testResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      ["superadmin"],
    );

    const user = testResult.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (isValid) {
      console.log("✅ Password verification successful!");
      console.log("\nYou can now login with:");
      console.log("Email: superadmin@panopticon.local");
      console.log("Password: SuperAdmin123!");
    } else {
      console.log("❌ Password verification failed!");
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    await pool.end();
    process.exit(1);
  }
}

fixSuperAdminPassword();
