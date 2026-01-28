// routes/message.routes.js - Message CRUD Routes
const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");
const logger = require("../utils/logger");

// Get messages between current user and another user
router.get("/conversation/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // User endpoints: Only show non-deleted messages
    const result = await pool.query(
      `SELECT 
        m.*,
        u1.username as sender_username,
        u2.username as receiver_username
      FROM messages m
      JOIN users u1 ON m.sender_id = u1.id
      JOIN users u2 ON m.receiver_id = u2.id
      WHERE 
        ((m.sender_id = $1 AND m.receiver_id = $2) OR 
         (m.sender_id = $2 AND m.receiver_id = $1))
        AND m.is_soft_deleted = false
      ORDER BY m.created_at ASC`,
      [currentUserId, userId],
    );

    res.json({
      success: true,
      messages: result.rows,
    });
  } catch (error) {
    logger.error("Get conversation error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages",
    });
  }
});

// Get all conversations for current user
router.get("/conversations", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (other_user_id)
        other_user_id,
        other_username,
        last_message,
        last_message_time
      FROM (
        SELECT 
          CASE 
            WHEN m.sender_id = $1 THEN m.receiver_id 
            ELSE m.sender_id 
          END as other_user_id,
          CASE 
            WHEN m.sender_id = $1 THEN u2.username 
            ELSE u1.username 
          END as other_username,
          m.content as last_message,
          m.created_at as last_message_time
        FROM messages m
        JOIN users u1 ON m.sender_id = u1.id
        JOIN users u2 ON m.receiver_id = u2.id
        WHERE 
          (m.sender_id = $1 OR m.receiver_id = $1)
          AND m.is_soft_deleted = false
        ORDER BY m.created_at DESC
      ) conversations
      ORDER BY other_user_id, last_message_time DESC`,
      [req.user.id],
    );

    res.json({
      success: true,
      conversations: result.rows,
    });
  } catch (error) {
    logger.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversations",
    });
  }
});

module.exports = router;
