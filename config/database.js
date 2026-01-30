// config/database.js - PostgreSQL Connection Pool Configuration
const { Pool } = require("pg");
const logger = require("../utils/logger");

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: "aws-0-ap-southeast-1.pooler.supabase.com",
  port: 6543, // ✅ Supabase pooler port
  user: "postgres.ffootkswnfxftdokfnhl", // format: postgres.PROJECT_REF
  password: process.env.DB_PASSWORD,
  database: "postgres",
  ssl: {
    rejectUnauthorized: false,
  },
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


