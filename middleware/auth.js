// middleware/auth.js - JWT Authentication & Role-Based Authorization
const jwt = require("../utils/jwt");
const pool = require("../config/database");
const logger = require("../utils/logger");

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error:
          "No token provided. Authorization header must be in format: Bearer <token>",
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    let decoded;
    try {
      decoded = jwt.verifyToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
        code: "TOKEN_INVALID",
      });
    }

    // Fetch user from database to get current role and status
    const result = await pool.query(
      "SELECT id, username, email, role, is_shadow_banned, is_active FROM users WHERE id = $1",
      [decoded.userId],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const user = result.rows[0];

    // Check if user account is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: "Account is deactivated",
        code: "ACCOUNT_DEACTIVATED",
      });
    }

    // Attach user to request object
    req.user = user;

    next();
  } catch (error) {
    logger.error("Authentication middleware error:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication failed",
      code: "AUTH_ERROR",
    });
  }
};

/**
 * Role-based authorization middleware factory
 * @param {Array<string>} allowedRoles - Array of roles that can access the route
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        code: "NOT_AUTHENTICATED",
      });
    }

    // GOD MODE: SuperAdmin has bypass privileges for ALL routes
    if (req.user.role === "superadmin") {
      logger.info(
        `SuperAdmin ${req.user.username} accessed route: ${req.method} ${req.path}`,
      );

      // Log superadmin access
      pool
        .query(
          "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
          [
            req.user.id,
            "SUPERADMIN_ACCESS",
            "INFO",
            JSON.stringify({
              method: req.method,
              path: req.path,
              ip: req.ip,
            }),
          ],
        )
        .catch((err) => logger.error("Failed to log superadmin access:", err));

      return next();
    }

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        `Unauthorized access attempt by ${req.user.username} (${req.user.role}) to ${req.path}`,
      );

      // Log unauthorized attempt
      pool
        .query(
          "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
          [
            req.user.id,
            "UNAUTHORIZED_ACCESS_ATTEMPT",
            "WARNING",
            JSON.stringify({
              method: req.method,
              path: req.path,
              requiredRoles: allowedRoles,
              userRole: req.user.role,
            }),
          ],
        )
        .catch((err) =>
          logger.error("Failed to log unauthorized attempt:", err),
        );

      return res.status(403).json({
        success: false,
        error: "Insufficient permissions",
        code: "FORBIDDEN",
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
};

/**
 * Superadmin-only middleware (for critical admin operations)
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "NOT_AUTHENTICATED",
    });
  }

  if (req.user.role !== "superadmin") {
    logger.warn(
      `Non-superadmin ${req.user.username} attempted to access superadmin route: ${req.path}`,
    );

    pool
      .query(
        "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
        [
          req.user.id,
          "SUPERADMIN_ACCESS_DENIED",
          "WARNING",
          JSON.stringify({
            method: req.method,
            path: req.path,
            userRole: req.user.role,
          }),
        ],
      )
      .catch((err) =>
        logger.error("Failed to log superadmin access denial:", err),
      );

    return res.status(403).json({
      success: false,
      error: "SuperAdmin access required",
      code: "SUPERADMIN_ONLY",
    });
  }

  next();
};

/**
 * Admin or SuperAdmin middleware
 */
const requireAdmin = (req, res, next) => {
  return authorize("admin", "superadmin")(req, res, next);
};

/**
 * Check if user is shadow banned (for API endpoints)
 * Shadow banned users get success responses but no actual data processing
 */
const checkShadowBan = (req, res, next) => {
  if (req.user && req.user.is_shadow_banned) {
    // Attach flag to request for controllers to handle
    req.isShadowBanned = true;

    logger.info(
      `Shadow banned user ${req.user.username} made request to ${req.path}`,
    );

    pool
      .query(
        "INSERT INTO logs (user_id, action_type, severity, metadata) VALUES ($1, $2, $3, $4)",
        [
          req.user.id,
          "SHADOW_BANNED_REQUEST",
          "INFO",
          JSON.stringify({
            method: req.method,
            path: req.path,
          }),
        ],
      )
      .catch((err) =>
        logger.error("Failed to log shadow banned request:", err),
      );
  }

  next();
};

/**
 * Optional authentication - attaches user if token is valid but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verifyToken(token);

      const result = await pool.query(
        "SELECT id, username, email, role, is_shadow_banned, is_active FROM users WHERE id = $1",
        [decoded.userId],
      );

      if (result.rows.length > 0 && result.rows[0].is_active) {
        req.user = result.rows[0];
      }
    } catch (error) {
      // Invalid token, but that's okay for optional auth
      logger.debug("Optional auth: Invalid token provided");
    }

    next();
  } catch (error) {
    logger.error("Optional auth middleware error:", error);
    next();
  }
};

module.exports = {
  authenticate,
  authorize,
  requireSuperAdmin,
  requireAdmin,
  checkShadowBan,
  optionalAuth,
};
