// config/database.js
const { Pool } = require("pg");
const logger = require("../utils/logger");

const pool = new Pool({
  host: "aws-0-ap-southeast-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.ffootkswnfxftdokfnhl",
  password: "/6C-UDMyAz4-z-E",
  database: "postgres",
  ssl: {
    rejectUnauthorized: false,
  },
});

// Test connection
pool.on("connect", () => {
  logger.info("New database connection established");
});

pool.on("error", (err) => {
  logger.error("Unexpected database error:", err);
  process.exit(1);
});

module.exports = pool;



