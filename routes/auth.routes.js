// routes/auth.routes.js - Authentication Routes
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const pool = require("../config/database");
const { generateToken, verifyToken } = require("../utils/jwt");
const logger = require("../utils/logger");

// Register new user
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role = "user" } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Username, email, and password are required",
      });
    }

    // Only superadmin can create admin or superadmin accounts
    if (
      (role === "admin" || role === "superadmin") &&
      (!req.user || req.user.role !== "superadmin")
    ) {
      return res.status(403).json({
        success: false,
        error: "Only SuperAdmin can create admin accounts",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(
      password,
      parseInt(process.env.BCRYPT_ROUNDS) || 10,
    );

    // Insert user
    const result = await pool.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role, created_at",
      [username, email, passwordHash, role],
    );

    const user = result.rows[0];

    // Log registration
    await pool.query(
      "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
      [user.id, "USER_REGISTERED", "INFO", JSON.stringify({ role })],
    );

    // Generate token
    const token = generateToken(user);

    logger.info(`New user registered: ${username} (${role})`);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      // Unique violation
      return res.status(409).json({
        success: false,
        error: "Username or email already exists",
      });
    }
    logger.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    // Fetch user
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: "Account is deactivated",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Update last login
    await pool.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id],
    );

    // Log login
    await pool.query(
      "INSERT INTO logs (user_id, action_type, ip_address, user_agent, severity, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        user.id,
        "USER_LOGIN",
        req.ip,
        req.get("user-agent"),
        "INFO",
        JSON.stringify({ role: user.role }),
      ],
    );

    // Generate token
    const token = generateToken(user);

    logger.info(`User logged in: ${user.username} (${user.role})`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isShadowBanned: user.is_shadow_banned,
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
});

// Logout
router.post("/logout", async (req, res) => {
  try {
    // Note: With JWT, logout is primarily client-side (remove token)
    // We log the event for audit purposes

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const decoded = verifyToken(token);

        await pool.query(
          "INSERT INTO logs (user_id, action_type, severity) VALUES ($1, $2, $3)",
          [decoded.userId, "USER_LOGOUT", "INFO"],
        );
      } catch (error) {
        // Invalid token, but that's okay for logout
      }
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout error:", error);
    res.status(500).json({
      success: false,
      error: "Logout failed",
    });
  }
});

module.exports = router;
