// utils/jwt.js - JWT Token Generation and Verification
const jwt = require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET || "panopticon_secret_change_in_production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: "panopticon-chat",
    audience: "panopticon-users",
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: "panopticon-chat",
      audience: "panopticon-users",
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token has expired");
    }
    if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    }
    throw error;
  }
}

function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}

function generateRefreshToken(user) {
  const payload = {
    userId: user.id,
    type: "refresh",
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
    issuer: "panopticon-chat",
    audience: "panopticon-users",
  });
}

module.exports = {
  generateToken,
  verifyToken,
  decodeToken,
  generateRefreshToken,
};
