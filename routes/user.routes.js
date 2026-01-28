// routes/user.routes.js - User Management Routes
const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");
const logger = require("../utils/logger");

// Get current user profile
router.get("/me", authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        isShadowBanned: req.user.is_shadow_banned,
      },
    });
  } catch (error) {
    logger.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch profile",
    });
  }
});

// Get all users (for chat list)
router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role, is_active, last_login FROM users WHERE is_active = true AND id != $1 ORDER BY username",
      [req.user.id],
    );

    res.json({
      success: true,
      users: result.rows,
    });
  } catch (error) {
    logger.error("Get users error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

module.exports = router;
