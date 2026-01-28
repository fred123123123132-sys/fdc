// middleware/errorHandler.js - Centralized Error Handling
const logger = require("../utils/logger");

/**
 * Centralized error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log error
  logger.error("Error occurred:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    user: req.user ? req.user.username : "unauthenticated",
  });

  // Default error status and message
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation failed";
  }

  if (err.name === "UnauthorizedError") {
    statusCode = 401;
    message = "Unauthorized access";
  }

  if (err.code === "23505") {
    // PostgreSQL unique violation
    statusCode = 409;
    message = "Resource already exists";
  }

  if (err.code === "23503") {
    // PostgreSQL foreign key violation
    statusCode = 400;
    message = "Invalid reference";
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      details: err.details,
    }),
  });
};

module.exports = errorHandler;
