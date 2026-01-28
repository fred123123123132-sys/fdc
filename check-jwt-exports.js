// check-jwt-exports.js - Debug what's being exported from jwt.js
console.log("Checking JWT module exports...\n");

try {
  const jwtModule = require("./utils/jwt");

  console.log("JWT Module Type:", typeof jwtModule);
  console.log("JWT Module Contents:", jwtModule);
  console.log("\nAvailable properties:");
  console.log("- generateToken:", typeof jwtModule.generateToken);
  console.log("- verifyToken:", typeof jwtModule.verifyToken);
  console.log("- decodeToken:", typeof jwtModule.decodeToken);
  console.log("- generateRefreshToken:", typeof jwtModule.generateRefreshToken);

  console.log("\n--- Testing Destructuring ---");
  const { generateToken, verifyToken } = require("./utils/jwt");
  console.log("generateToken type:", typeof generateToken);
  console.log("verifyToken type:", typeof verifyToken);

  if (typeof generateToken === "function") {
    console.log("\n✅ JWT module exports are correct!");
  } else {
    console.log("\n❌ JWT module exports are INCORRECT!");
    console.log(
      "Fix utils/jwt.js - ensure it exports: { generateToken, verifyToken, ... }",
    );
  }
} catch (error) {
  console.error("❌ Error loading JWT module:", error.message);
  console.error("\nFull error:", error);
}
