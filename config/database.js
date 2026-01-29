// config/database.js - PostgreSQL Connection Pool Configuration
const { Pool } = require("pg");
const logger = require("../utils/logger");

const pool = new Pool({
  host: process.env.DB_HOST || "db.ffootkswnfxftdokfnhl.supabase.co",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "postgres",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// Test connection on startup
pool.on("connect", () => {
  logger.info("New database connection established");
});

pool.on("error", (err) => {
  logger.error("Unexpected database error:", err);
  process.exit(-1);
});

module.exports = pool;

