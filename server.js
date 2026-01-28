require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const pool = require("./config/database");
const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const messageRoutes = require("./routes/message.routes");
const adminRoutes = require("./routes/admin.routes");

const uploadRoutes = require("./routes/upload.routes");
const path = require("path");

const setupSocketHandlers = require("./socket/socketHandler");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "operational", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/uploads", uploadRoutes);

app.use(errorHandler);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication token required"));
    }

    const jwt = require("./utils/jwt");
    const decoded = jwt.verifyToken(token);

    const result = await pool.query(
      "SELECT id, username, email, role, is_shadow_banned, is_active FROM users WHERE id = $1",
      [decoded.userId],
    );

    if (result.rows.length === 0) {
      return next(new Error("User not found"));
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return next(new Error("Account is deactivated"));
    }

    socket.user = user;
    next();
  } catch (error) {
    logger.error("Socket authentication error:", error);
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const user = socket.user;

  logger.info(`User connected: ${user.username} (${user.id})`, {
    role: user.role,
    socketId: socket.id,
  });

  pool
    .query(
      "INSERT INTO logs (user_id, action_type, ip_address, user_agent, metadata) VALUES ($1, $2, $3, $4, $5)",
      [
        user.id,
        "SOCKET_CONNECTED",
        socket.handshake.address,
        socket.handshake.headers["user-agent"],
        JSON.stringify({ socketId: socket.id }),
      ],
    )
    .catch((err) => logger.error("Failed to log connection:", err));

  socket.join(`room_${user.id}`);
  logger.info(`User ${user.username} joined room: room_${user.id}`);

  if (user.role === "superadmin") {
    socket.join("super_admin_monitor");
    logger.info(`SuperAdmin ${user.username} joined monitoring room`);

    socket.emit("monitoring_active", {
      message: "God Mode Active: Monitoring all communications",
      timestamp: new Date().toISOString(),
    });
  }

  socket.on("send_message", async (data) => {
    try {
      const { receiverId, content } = data;

      if (!receiverId || !content || content.trim().length === 0) {
        socket.emit("message_error", { error: "Invalid message data" });
        return;
      }

      const senderResult = await pool.query(
        "SELECT id, username, role, is_shadow_banned FROM users WHERE id = $1",
        [user.id],
      );
      const sender = senderResult.rows[0];

      if (sender.is_shadow_banned) {
        logger.warn(
          `Shadow banned user ${sender.username} attempted to send message`,
          {
            senderId: sender.id,
            receiverId,
          },
        );

        socket.emit("message_sent", {
          id: require("crypto").randomUUID(),
          senderId: sender.id,
          receiverId,
          content,
          createdAt: new Date().toISOString(),
          status: "delivered",
        });

        await pool.query(
          "INSERT INTO logs (user_id, action_type, target_user_id, severity, metadata) VALUES ($1, $2, $3, $4, $5)",
          [
            sender.id,
            "SHADOW_BANNED_MESSAGE_BLOCKED",
            receiverId,
            "WARNING",
            JSON.stringify({ content: content.substring(0, 100) }),
          ],
        );

        io.to("super_admin_monitor").emit("shadow_banned_message", {
          id: require("crypto").randomUUID(),
          sender: { id: sender.id, username: sender.username },
          receiverId,
          content,
          blocked: true,
          timestamp: new Date().toISOString(),
        });

        return;
      }

      const receiverResult = await pool.query(
        "SELECT id, username FROM users WHERE id = $1 AND is_active = true",
        [receiverId],
      );

      if (receiverResult.rows.length === 0) {
        socket.emit("message_error", { error: "Receiver not found" });
        return;
      }

      const messageResult = await pool.query(
        "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *",
        [sender.id, receiverId, content],
      );

      const message = messageResult.rows[0];

      await pool.query(
        "INSERT INTO logs (user_id, action_type, target_user_id, target_message_id, metadata) VALUES ($1, $2, $3, $4, $5)",
        [
          sender.id,
          "MESSAGE_SENT",
          receiverId,
          message.id,
          JSON.stringify({ contentLength: content.length }),
        ],
      );

      const messagePayload = {
        id: message.id,
        senderId: sender.id,
        senderUsername: sender.username,
        receiverId: message.receiver_id,
        content: message.content,
        createdAt: message.created_at,
        status: "delivered",
      };

      socket.emit("message_sent", messagePayload);

      io.to(`room_${receiverId}`).emit("new_message", messagePayload);

      io.to("super_admin_monitor").emit("intercepted_message", {
        ...messagePayload,
        intercepted: true,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Message sent: ${sender.username} -> Receiver ${receiverId}`);
    } catch (error) {
      logger.error("Error sending message:", error);
      socket.emit("message_error", { error: "Failed to send message" });
    }
  });

  socket.on("delete_message", async (data) => {
    try {
      const { messageId } = data;

      const result = await pool.query("SELECT * FROM messages WHERE id = $1", [
        messageId,
      ]);

      if (result.rows.length === 0) {
        socket.emit("delete_error", { error: "Message not found" });
        return;
      }

      const message = result.rows[0];

      if (
        message.sender_id !== user.id &&
        user.role !== "admin" &&
        user.role !== "superadmin"
      ) {
        socket.emit("delete_error", { error: "Unauthorized" });
        return;
      }

      await pool.query(
        "UPDATE messages SET is_soft_deleted = true, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
        [user.id, messageId],
      );

      await pool.query(
        "INSERT INTO logs (user_id, action_type, target_message_id, metadata) VALUES ($1, $2, $3, $4)",
        [
          user.id,
          "MESSAGE_DELETED",
          messageId,
          JSON.stringify({ deletedBy: user.role }),
        ],
      );

      socket.emit("message_deleted", { messageId });

      io.to(`room_${message.receiver_id}`).emit("message_deleted", {
        messageId,
      });

      io.to("super_admin_monitor").emit("message_deleted_event", {
        messageId,
        deletedBy: { id: user.id, username: user.username, role: user.role },
        timestamp: new Date().toISOString(),
      });

      logger.info(`Message ${messageId} soft-deleted by ${user.username}`);
    } catch (error) {
      logger.error("Error deleting message:", error);
      socket.emit("delete_error", { error: "Failed to delete message" });
    }
  });

  socket.on("disconnect", () => {
    logger.info(`User disconnected: ${user.username} (${user.id})`);

    pool
      .query(
        "INSERT INTO logs (user_id, action_type, metadata) VALUES ($1, $2, $3)",
        [
          user.id,
          "SOCKET_DISCONNECTED",
          JSON.stringify({ socketId: socket.id }),
        ],
      )
      .catch((err) => logger.error("Failed to log disconnection:", err));
  });
});

setupSocketHandlers(io, pool);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  logger.info(`Panopticon Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

  pool.query("SELECT NOW()", (err, res) => {
    if (err) {
      logger.error("Database connection failed:", err);
    } else {
      logger.info("Database connected successfully");
    }
  });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    pool.end(() => {
      logger.info("Database pool closed");
      process.exit(0);
    });
  });
});

module.exports = { app, io, server };
