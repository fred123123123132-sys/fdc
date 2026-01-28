// socket/socketHandler.js - Additional Socket.io Event Handlers
const logger = require("../utils/logger");

/**
 * Setup additional socket event handlers
 * @param {Server} io - Socket.io server instance
 * @param {Pool} pool - PostgreSQL connection pool
 */
const setupSocketHandlers = (io, pool) => {
  // SuperAdmin: Request real-time user list
  io.on("connection", (socket) => {
    // SuperAdmin: Get all active users
    socket.on("admin:get_active_users", async () => {
      if (socket.user.role !== "superadmin" && socket.user.role !== "admin") {
        socket.emit("error", {
          message: "Unauthorized: Admin access required",
        });
        return;
      }

      try {
        const result = await pool.query(
          "SELECT id, username, email, role, is_shadow_banned, is_active, last_login FROM users WHERE is_active = true ORDER BY last_login DESC",
        );

        socket.emit("admin:active_users", {
          users: result.rows,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error fetching active users:", error);
        socket.emit("error", { message: "Failed to fetch active users" });
      }
    });

    // SuperAdmin: Get all messages (including soft-deleted)
    socket.on("admin:get_all_messages", async (filters = {}) => {
      if (socket.user.role !== "superadmin" && socket.user.role !== "admin") {
        socket.emit("error", {
          message: "Unauthorized: Admin access required",
        });
        return;
      }

      try {
        let query = `
          SELECT 
            m.*,
            u1.username as sender_username,
            u2.username as receiver_username
          FROM messages m
          JOIN users u1 ON m.sender_id = u1.id
          JOIN users u2 ON m.receiver_id = u2.id
        `;

        const conditions = [];
        const params = [];
        let paramCount = 1;

        if (filters.userId) {
          conditions.push(
            `(m.sender_id = $${paramCount} OR m.receiver_id = $${paramCount})`,
          );
          params.push(filters.userId);
          paramCount++;
        }

        if (filters.showDeletedOnly) {
          conditions.push("m.is_soft_deleted = true");
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY m.created_at DESC LIMIT 100";

        const result = await pool.query(query, params);

        socket.emit("admin:all_messages", {
          messages: result.rows,
          timestamp: new Date().toISOString(),
        });

        // Log admin access
        await pool.query(
          "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
          [
            socket.user.id,
            "ADMIN_VIEWED_ALL_MESSAGES",
            "INFO",
            JSON.stringify({ filters }),
          ],
        );
      } catch (error) {
        logger.error("Error fetching all messages:", error);
        socket.emit("error", { message: "Failed to fetch messages" });
      }
    });

    // SuperAdmin: Shadow ban/unban user
    socket.on("admin:toggle_shadow_ban", async (data) => {
      if (socket.user.role !== "superadmin") {
        socket.emit("error", {
          message: "Unauthorized: SuperAdmin access required",
        });
        return;
      }

      try {
        const { userId, shadowBan } = data;

        // Prevent superadmin from shadow banning themselves
        if (userId === socket.user.id) {
          socket.emit("error", { message: "Cannot shadow ban yourself" });
          return;
        }

        // Update user
        await pool.query(
          "UPDATE users SET is_shadow_banned = $1 WHERE id = $2",
          [shadowBan, userId],
        );

        // Log action
        await pool.query(
          "INSERT INTO logs (user_id, action_type, target_user_id, severity, metadata) VALUES ($1, $2, $3, $4, $5)",
          [
            socket.user.id,
            shadowBan ? "USER_SHADOW_BANNED" : "USER_SHADOW_UNBANNED",
            userId,
            "CRITICAL",
            JSON.stringify({ performedBy: socket.user.username }),
          ],
        );

        // Notify all admins
        io.to("super_admin_monitor").emit("admin:shadow_ban_updated", {
          userId,
          shadowBan,
          performedBy: socket.user.username,
          timestamp: new Date().toISOString(),
        });

        socket.emit("admin:shadow_ban_success", {
          userId,
          shadowBan,
          message: `User ${shadowBan ? "shadow banned" : "unbanned"} successfully`,
        });

        logger.info(
          `User ${userId} ${shadowBan ? "shadow banned" : "unbanned"} by ${socket.user.username}`,
        );
      } catch (error) {
        logger.error("Error toggling shadow ban:", error);
        socket.emit("error", { message: "Failed to update shadow ban status" });
      }
    });

    // SuperAdmin: Get audit logs
    socket.on("admin:get_logs", async (filters = {}) => {
      if (socket.user.role !== "superadmin" && socket.user.role !== "admin") {
        socket.emit("error", {
          message: "Unauthorized: Admin access required",
        });
        return;
      }

      try {
        let query = `
          SELECT 
            l.*,
            u.username as user_username
          FROM logs l
          LEFT JOIN users u ON l.user_id = u.id
        `;

        const conditions = [];
        const params = [];
        let paramCount = 1;

        if (filters.userId) {
          conditions.push(`l.user_id = $${paramCount}`);
          params.push(filters.userId);
          paramCount++;
        }

        if (filters.actionType) {
          conditions.push(`l.action_type = $${paramCount}`);
          params.push(filters.actionType);
          paramCount++;
        }

        if (filters.severity) {
          conditions.push(`l.severity = $${paramCount}`);
          params.push(filters.severity);
          paramCount++;
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY l.created_at DESC LIMIT 200";

        const result = await pool.query(query, params);

        socket.emit("admin:logs", {
          logs: result.rows,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error fetching logs:", error);
        socket.emit("error", { message: "Failed to fetch logs" });
      }
    });

    // User: Typing indicator
    socket.on("typing", (data) => {
      const { receiverId } = data;

      // Don't emit if user is shadow banned
      if (socket.user.is_shadow_banned) {
        return;
      }

      io.to(`room_${receiverId}`).emit("user_typing", {
        userId: socket.user.id,
        username: socket.user.username,
      });
    });

    // User: Stop typing indicator
    socket.on("stop_typing", (data) => {
      const { receiverId } = data;

      if (socket.user.is_shadow_banned) {
        return;
      }

      io.to(`room_${receiverId}`).emit("user_stop_typing", {
        userId: socket.user.id,
        username: socket.user.username,
      });
    });

    // User: Mark message as read
    socket.on("mark_read", async (data) => {
      try {
        const { messageId } = data;

        // Verify user is the receiver
        const result = await pool.query(
          "SELECT receiver_id FROM messages WHERE id = $1",
          [messageId],
        );

        if (
          result.rows.length === 0 ||
          result.rows[0].receiver_id !== socket.user.id
        ) {
          return;
        }

        // Emit read receipt to sender
        const senderId = result.rows[0].sender_id;
        io.to(`room_${senderId}`).emit("message_read", {
          messageId,
          readBy: socket.user.id,
          readAt: new Date().toISOString(),
        });

        // Also notify monitoring room
        io.to("super_admin_monitor").emit("message_read_event", {
          messageId,
          readBy: socket.user.username,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error marking message as read:", error);
      }
    });
  });

  logger.info("Additional socket handlers initialized");
};

module.exports = setupSocketHandlers;
