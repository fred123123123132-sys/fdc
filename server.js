// Add this at the VERY TOP of server.js (before anything else)
console.log("🚀 Server starting...");
console.log("Node version:", process.version);
console.log("Current directory:", process.cwd());

// Check environment variables
console.log("Checking environment variables...");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "✅ SET" : "❌ NOT SET");
console.log("CLIENT_URL:", process.env.CLIENT_URL || "not set (using default)");
console.log("PORT:", process.env.PORT || "not set (using 5000)");
console.log("NODE_ENV:", process.env.NODE_ENV || "not set");

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

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

let io;
try {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  logger.info("Socket.io server initialized successfully");
} catch (error) {
  logger.error("Failed to initialize Socket.io server:", error);
  process.exit(1);
}

try {
  app.use(helmet());
  logger.info("Helmet middleware applied");
} catch (error) {
  logger.error("Failed to apply Helmet middleware:", error);
}

try {
  app.use(
    cors({
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    }),
  );
  logger.info("CORS middleware applied");
} catch (error) {
  logger.error("Failed to apply CORS middleware:", error);
}

try {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later.",
  });
  app.use("/api/", limiter);
  logger.info("Rate limiter middleware applied");
} catch (error) {
  logger.error("Failed to apply rate limiter middleware:", error);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

try {
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  logger.info("Static uploads directory configured");
} catch (error) {
  logger.error("Failed to configure static uploads directory:", error);
}

app.use((req, res, next) => {
  try {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
  } catch (error) {
    logger.error("Failed to log request:", error);
  }
  next();
});

app.get("/health", (req, res) => {
  try {
    res.json({ status: "operational", timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error("Health check failed:", error);
    res.status(500).json({ status: "error", error: error.message });
  }
});

try {
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/uploads", uploadRoutes);
  logger.info("All routes registered successfully");
} catch (error) {
  logger.error("Failed to register routes:", error);
}

app.use(errorHandler);

// Global error handler for uncaught route errors
app.use((err, req, res, next) => {
  logger.error("Unhandled route error:", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: "Internal server error" });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      logger.warn("Socket connection attempted without token", {
        address: socket.handshake.address,
      });
      return next(new Error("Authentication token required"));
    }

    let decoded;
    try {
      const jwt = require("./utils/jwt");
      decoded = jwt.verifyToken(token);
    } catch (jwtError) {
      logger.error("JWT verification failed:", {
        error: jwtError.message,
        address: socket.handshake.address,
      });
      return next(new Error("Invalid token"));
    }

    let result;
    try {
      result = await pool.query(
        "SELECT id, username, email, role, is_shadow_banned, is_active FROM users WHERE id = $1",
        [decoded.userId],
      );
    } catch (dbError) {
      logger.error("Database query failed during socket auth:", {
        error: dbError.message,
        userId: decoded.userId,
      });
      return next(new Error("Authentication failed - database error"));
    }

    if (result.rows.length === 0) {
      logger.warn("Socket auth failed - user not found:", {
        userId: decoded.userId,
      });
      return next(new Error("User not found"));
    }

    const user = result.rows[0];

    if (!user.is_active) {
      logger.warn("Socket auth failed - account deactivated:", {
        userId: user.id,
        username: user.username,
      });
      return next(new Error("Account is deactivated"));
    }

    socket.user = user;
    logger.info("Socket authentication successful:", {
      userId: user.id,
      username: user.username,
    });
    next();
  } catch (error) {
    logger.error("Socket authentication error:", {
      error: error.message,
      stack: error.stack,
      address: socket.handshake.address,
    });
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const user = socket.user;

  try {
    logger.info(`User connected: ${user.username} (${user.id})`, {
      role: user.role,
      socketId: socket.id,
    });
  } catch (error) {
    logger.error("Error logging user connection:", error);
  }

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
    .catch((err) =>
      logger.error("Failed to log connection:", {
        error: err.message,
        userId: user.id,
        socketId: socket.id,
      }),
    );

  try {
    socket.join(`room_${user.id}`);
    logger.info(`User ${user.username} joined room: room_${user.id}`);
  } catch (error) {
    logger.error("Failed to join user room:", {
      error: error.message,
      userId: user.id,
      room: `room_${user.id}`,
    });
  }

  if (user.role === "superadmin") {
    try {
      socket.join("super_admin_monitor");
      logger.info(`SuperAdmin ${user.username} joined monitoring room`);

      socket.emit("monitoring_active", {
        message: "God Mode Active: Monitoring all communications",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to setup superadmin monitoring:", {
        error: error.message,
        userId: user.id,
      });
    }
  }

  socket.on("send_message", async (data) => {
    try {
      const { receiverId, content } = data;

      if (!receiverId || !content || content.trim().length === 0) {
        logger.warn("Invalid message data received:", {
          userId: user.id,
          receiverId,
          hasContent: !!content,
        });
        socket.emit("message_error", { error: "Invalid message data" });
        return;
      }

      let sender;
      try {
        const senderResult = await pool.query(
          "SELECT id, username, role, is_shadow_banned FROM users WHERE id = $1",
          [user.id],
        );
        sender = senderResult.rows[0];
      } catch (dbError) {
        logger.error("Failed to fetch sender data:", {
          error: dbError.message,
          userId: user.id,
        });
        socket.emit("message_error", { error: "Failed to send message" });
        return;
      }

      if (!sender) {
        logger.error("Sender not found in database:", { userId: user.id });
        socket.emit("message_error", { error: "Sender not found" });
        return;
      }

      if (sender.is_shadow_banned) {
        logger.warn(
          `Shadow banned user ${sender.username} attempted to send message`,
          {
            senderId: sender.id,
            receiverId,
          },
        );

        try {
          socket.emit("message_sent", {
            id: require("crypto").randomUUID(),
            senderId: sender.id,
            receiverId,
            content,
            createdAt: new Date().toISOString(),
            status: "delivered",
          });
        } catch (emitError) {
          logger.error("Failed to emit fake message_sent to shadow banned user:", {
            error: emitError.message,
            userId: sender.id,
          });
        }

        try {
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
        } catch (logError) {
          logger.error("Failed to log shadow banned message:", {
            error: logError.message,
            userId: sender.id,
          });
        }

        try {
          io.to("super_admin_monitor").emit("shadow_banned_message", {
            id: require("crypto").randomUUID(),
            sender: { id: sender.id, username: sender.username },
            receiverId,
            content,
            blocked: true,
            timestamp: new Date().toISOString(),
          });
        } catch (emitError) {
          logger.error("Failed to emit shadow_banned_message to admins:", {
            error: emitError.message,
            userId: sender.id,
          });
        }

        return;
      }

      let receiver;
      try {
        const receiverResult = await pool.query(
          "SELECT id, username FROM users WHERE id = $1 AND is_active = true",
          [receiverId],
        );
        receiver = receiverResult.rows[0];
      } catch (dbError) {
        logger.error("Failed to fetch receiver data:", {
          error: dbError.message,
          receiverId,
        });
        socket.emit("message_error", { error: "Failed to send message" });
        return;
      }

      if (!receiver) {
        logger.warn("Receiver not found or inactive:", {
          receiverId,
          senderId: sender.id,
        });
        socket.emit("message_error", { error: "Receiver not found" });
        return;
      }

      let message;
      try {
        const messageResult = await pool.query(
          "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *",
          [sender.id, receiverId, content],
        );
        message = messageResult.rows[0];
      } catch (dbError) {
        logger.error("Failed to insert message into database:", {
          error: dbError.message,
          senderId: sender.id,
          receiverId,
        });
        socket.emit("message_error", { error: "Failed to send message" });
        return;
      }

      try {
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
      } catch (logError) {
        logger.error("Failed to log message sent:", {
          error: logError.message,
          messageId: message.id,
        });
      }

      const messagePayload = {
        id: message.id,
        senderId: sender.id,
        senderUsername: sender.username,
        receiverId: message.receiver_id,
        content: message.content,
        createdAt: message.created_at,
        status: "delivered",
      };

      try {
        socket.emit("message_sent", messagePayload);
      } catch (emitError) {
        logger.error("Failed to emit message_sent to sender:", {
          error: emitError.message,
          messageId: message.id,
        });
      }

      try {
        io.to(`room_${receiverId}`).emit("new_message", messagePayload);
      } catch (emitError) {
        logger.error("Failed to emit new_message to receiver:", {
          error: emitError.message,
          messageId: message.id,
          receiverId,
        });
      }

      try {
        io.to("super_admin_monitor").emit("intercepted_message", {
          ...messagePayload,
          intercepted: true,
          timestamp: new Date().toISOString(),
        });
      } catch (emitError) {
        logger.error("Failed to emit intercepted_message to admins:", {
          error: emitError.message,
          messageId: message.id,
        });
      }

      logger.info(`Message sent: ${sender.username} -> Receiver ${receiverId}`, {
        messageId: message.id,
      });
    } catch (error) {
      logger.error("Error sending message:", {
        error: error.message,
        stack: error.stack,
        userId: user.id,
        data,
      });
      socket.emit("message_error", { error: "Failed to send message" });
    }
  });

  socket.on("delete_message", async (data) => {
    try {
      const { messageId } = data;

      if (!messageId) {
        logger.warn("Delete message called without messageId:", {
          userId: user.id,
        });
        socket.emit("delete_error", { error: "Message ID required" });
        return;
      }

      let message;
      try {
        const result = await pool.query("SELECT * FROM messages WHERE id = $1", [
          messageId,
        ]);
        message = result.rows[0];
      } catch (dbError) {
        logger.error("Failed to fetch message for deletion:", {
          error: dbError.message,
          messageId,
        });
        socket.emit("delete_error", { error: "Failed to delete message" });
        return;
      }

      if (!message) {
        logger.warn("Message not found for deletion:", {
          messageId,
          userId: user.id,
        });
        socket.emit("delete_error", { error: "Message not found" });
        return;
      }

      if (
        message.sender_id !== user.id &&
        user.role !== "admin" &&
        user.role !== "superadmin"
      ) {
        logger.warn("Unauthorized delete attempt:", {
          messageId,
          userId: user.id,
          senderId: message.sender_id,
          userRole: user.role,
        });
        socket.emit("delete_error", { error: "Unauthorized" });
        return;
      }

      try {
        await pool.query(
          "UPDATE messages SET is_soft_deleted = true, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
          [user.id, messageId],
        );
      } catch (dbError) {
        logger.error("Failed to soft delete message:", {
          error: dbError.message,
          messageId,
        });
        socket.emit("delete_error", { error: "Failed to delete message" });
        return;
      }

      try {
        await pool.query(
          "INSERT INTO logs (user_id, action_type, target_message_id, metadata) VALUES ($1, $2, $3, $4)",
          [
            user.id,
            "MESSAGE_DELETED",
            messageId,
            JSON.stringify({ deletedBy: user.role }),
          ],
        );
      } catch (logError) {
        logger.error("Failed to log message deletion:", {
          error: logError.message,
          messageId,
        });
      }

      try {
        socket.emit("message_deleted", { messageId });
      } catch (emitError) {
        logger.error("Failed to emit message_deleted to sender:", {
          error: emitError.message,
          messageId,
        });
      }

      try {
        io.to(`room_${message.receiver_id}`).emit("message_deleted", {
          messageId,
        });
      } catch (emitError) {
        logger.error("Failed to emit message_deleted to receiver:", {
          error: emitError.message,
          messageId,
          receiverId: message.receiver_id,
        });
      }

      try {
        io.to("super_admin_monitor").emit("message_deleted_event", {
          messageId,
          deletedBy: { id: user.id, username: user.username, role: user.role },
          timestamp: new Date().toISOString(),
        });
      } catch (emitError) {
        logger.error("Failed to emit message_deleted_event to admins:", {
          error: emitError.message,
          messageId,
        });
      }

      logger.info(`Message ${messageId} soft-deleted by ${user.username}`, {
        deletedBy: user.role,
      });
    } catch (error) {
      logger.error("Error deleting message:", {
        error: error.message,
        stack: error.stack,
        userId: user.id,
        data,
      });
      socket.emit("delete_error", { error: "Failed to delete message" });
    }
  });

  socket.on("disconnect", (reason) => {
    try {
      logger.info(`User disconnected: ${user.username} (${user.id})`, {
        reason,
        socketId: socket.id,
      });
    } catch (error) {
      logger.error("Error logging disconnect:", error);
    }

    pool
      .query(
        "INSERT INTO logs (user_id, action_type, metadata) VALUES ($1, $2, $3)",
        [
          user.id,
          "SOCKET_DISCONNECTED",
          JSON.stringify({ socketId: socket.id, reason }),
        ],
      )
      .catch((err) =>
        logger.error("Failed to log disconnection:", {
          error: err.message,
          userId: user.id,
        }),
      );
  });

  socket.on("error", (error) => {
    logger.error("Socket error:", {
      error: error.message,
      stack: error.stack,
      userId: user.id,
      socketId: socket.id,
    });
  });
});

io.on("error", (error) => {
  logger.error("Socket.io server error:", {
    error: error.message,
    stack: error.stack,
  });
});

try {
  setupSocketHandlers(io, pool);
  logger.info("Socket handlers setup successfully");
} catch (error) {
  logger.error("Failed to setup socket handlers:", {
    error: error.message,
    stack: error.stack,
  });
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  logger.info(`Panopticon Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

  pool.query("SELECT NOW()", (err, res) => {
    if (err) {
      logger.error("Database connection failed:", {
        error: err.message,
        stack: err.stack,
      });
    } else {
      logger.info("Database connected successfully", {
        serverTime: res.rows[0].now,
      });
    }
  });
});

server.on("error", (error) => {
  logger.error("HTTP server error:", {
    error: error.message,
    stack: error.stack,
  });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close((err) => {
    if (err) {
      logger.error("Error closing HTTP server:", err);
    }
    logger.info("HTTP server closed");
    pool.end((err) => {
      if (err) {
        logger.error("Error closing database pool:", err);
      }
      logger.info("Database pool closed");
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  server.close((err) => {
    if (err) {
      logger.error("Error closing HTTP server:", err);
    }
    logger.info("HTTP server closed");
    pool.end((err) => {
      if (err) {
        logger.error("Error closing database pool:", err);
      }
      logger.info("Database pool closed");
      process.exit(0);
    });
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection:", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

module.exports = { app, io, server };

