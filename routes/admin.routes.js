// routes/admin.routes.js - Admin & SuperAdmin Routes
const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const {
  authenticate,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/auth");
const logger = require("../utils/logger");

// Get ALL messages including soft-deleted (Admin/SuperAdmin only)
router.get("/messages/all", authenticate, requireAdmin, async (req, res) => {
  try {
    const { limit = 100, offset = 0, userId, showDeletedOnly } = req.query;

    let query = `
      SELECT 
        m.*,
        u1.username as sender_username,
        u2.username as receiver_username,
        u3.username as deleted_by_username
      FROM messages m
      JOIN users u1 ON m.sender_id = u1.id
      JOIN users u2 ON m.receiver_id = u2.id
      LEFT JOIN users u3 ON m.deleted_by = u3.id
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (userId) {
      conditions.push(
        `(m.sender_id = $${paramCount} OR m.receiver_id = $${paramCount})`,
      );
      params.push(userId);
      paramCount++;
    }

    if (showDeletedOnly === "true") {
      conditions.push("m.is_soft_deleted = true");
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Log admin access
    await pool.query(
      "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
      [
        req.user.id,
        "ADMIN_VIEWED_ALL_MESSAGES",
        "INFO",
        JSON.stringify({ filters: { userId, showDeletedOnly } }),
      ],
    );

    res.json({
      success: true,
      messages: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error("Admin get all messages error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages",
    });
  }
});

// Get all users (Admin/SuperAdmin only)
router.get("/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role, is_shadow_banned, is_active, created_at, last_login FROM users ORDER BY created_at DESC",
    );

    res.json({
      success: true,
      users: result.rows,
    });
  } catch (error) {
    logger.error("Admin get users error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

// Shadow ban/unban user (SuperAdmin only)
router.post(
  "/users/:userId/shadow-ban",
  authenticate,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { shadowBan } = req.body;

      // Prevent superadmin from banning themselves
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: "Cannot shadow ban yourself",
        });
      }

      await pool.query("UPDATE users SET is_shadow_banned = $1 WHERE id = $2", [
        shadowBan,
        userId,
      ]);

      // Log action
      await pool.query(
        "INSERT INTO logs (user_id, action_type, target_user_id, severity, metadata) VALUES ($1, $2, $3, $4, $5)",
        [
          req.user.id,
          shadowBan ? "USER_SHADOW_BANNED" : "USER_SHADOW_UNBANNED",
          userId,
          "CRITICAL",
          JSON.stringify({ performedBy: req.user.username }),
        ],
      );

      logger.info(
        `User ${userId} ${shadowBan ? "shadow banned" : "unbanned"} by ${req.user.username}`,
      );

      res.json({
        success: true,
        message: `User ${shadowBan ? "shadow banned" : "unbanned"} successfully`,
      });
    } catch (error) {
      logger.error("Shadow ban error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update shadow ban status",
      });
    }
  },
);

// Deactivate user account (SuperAdmin only)
router.post(
  "/users/:userId/deactivate",
  authenticate,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: "Cannot deactivate yourself",
        });
      }

      await pool.query("UPDATE users SET is_active = false WHERE id = $1", [
        userId,
      ]);

      await pool.query(
        "INSERT INTO logs (user_id, action_type, target_user_id, severity, metadata) VALUES ($1, $2, $3, $4, $5)",
        [
          req.user.id,
          "USER_DEACTIVATED",
          userId,
          "CRITICAL",
          JSON.stringify({ performedBy: req.user.username }),
        ],
      );

      res.json({
        success: true,
        message: "User deactivated successfully",
      });
    } catch (error) {
      logger.error("Deactivate user error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to deactivate user",
      });
    }
  },
);

// Get audit logs (Admin/SuperAdmin only)
router.get("/logs", authenticate, requireAdmin, async (req, res) => {
  try {
    const { limit = 200, offset = 0, userId, actionType, severity } = req.query;

    let query = `
      SELECT 
        l.*,
        u.username as user_username,
        tu.username as target_username
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN users tu ON l.target_user_id = tu.id
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (userId) {
      conditions.push(`l.user_id = $${paramCount}`);
      params.push(userId);
      paramCount++;
    }

    if (actionType) {
      conditions.push(`l.action_type = $${paramCount}`);
      params.push(actionType);
      paramCount++;
    }

    if (severity) {
      conditions.push(`l.severity = $${paramCount}`);
      params.push(severity);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += ` ORDER BY l.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      logs: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error("Get logs error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch logs",
    });
  }
});

module.exports = router;
