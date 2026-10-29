const { Pool, types, defaults } = require("pg");
const { log } = require("../utils/log");
const { attachDatabasePool } = require("@vercel/functions");

// Stored times are UTC wall clock (timestamp without time zone). Read them as UTC and write Dates as
// UTC, whatever zone this machine runs in: on a laptop in Dhaka the driver would otherwise shift both
// by six hours. A date column is a calendar day and stays the string it is, never a midnight that moves.
types.setTypeParser(types.builtins.TIMESTAMP, (value) => new Date(value.replace(" ", "T") + "Z"));
types.setTypeParser(types.builtins.DATE, (value) => value);
defaults.parseInputDatesAsUTC = true;

// ENV_FILE lets a local dev point at a different env (e.g. ./src/env/.env.local)
// without touching the committed cloud .env. Defaults to the cloud env.
require("dotenv").config({ path: process.env.ENV_FILE || `./src/env/.env`, quiet: true });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  // The free Aiven plan leaves about 16 connections and has no pooler. Vercel starts a copy per burst
  // and a frozen copy keeps its connections, so 5 a copy ran out at three or four copies. A
  // transaction never waits on a second connection, so a small pool cannot deadlock; 3 lets a page
  // that reads several things at once run three at a time. See docs/capacity in stock-flow-documents.
  max: 3,
  min: 0, // Allow scaling down to 0 for serverless
  // A frozen copy cannot run its idle timer, so the database closes idle connections itself at 30
  // seconds, after the pool's 20. Appended to PGOPTIONS because `options` overrides it.
  idleTimeoutMillis: 20000,
  options: [process.env.PGOPTIONS, "-c idle_session_timeout=30s"].filter(Boolean).join(" "),
  connectionTimeoutMillis: 10000, // 10 seconds - increased for cloud databases
  maxUses: 7500,
  // Local Postgres has SSL off; set DB_SSL=false to connect without SSL.
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  // Add query timeout to prevent hanging queries
  query_timeout: 30000, // 30 seconds query timeout
  statement_timeout: 30000, // 30 seconds statement timeout
  // Enable keep-alive to prevent connection drops
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // 10 seconds
});

// Under Fluid compute this keeps a copy awake until its pool has closed its idle connections, so a
// copy is frozen holding none.
attachDatabasePool(pool);

// Handle pool errors to prevent crashes
pool.on("error", (err, client) => {
  log.warn(`Idle database connection closed: ${err?.code} ${err?.message}`);
  // Don't exit the process, just log the error
});

// Handle connection events
pool.on("connect", (client) => {
  console.log("🔗 New client connected to database:");
});

pool.on("remove", (client) => {
  console.log("🔌 Client removed from pool");
});

// Test the database connection with retry logic
const testConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log("✅ Database connected successfully!");
      client.release();
      return;
    } catch (err) {
      console.error(
        `❌ Database connection error (attempt ${i + 1}/${retries}):`,
        err.message,
      );
      if (i === retries - 1) {
        console.error("Failed to connect after", retries, "attempts");
      } else {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, i)),
        );
      }
    }
  }
};

testConnection();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await pool.end();
  console.log("✅ Database pool closed");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await pool.end();
  console.log("✅ Database pool closed");
  process.exit(0);
});

module.exports = pool;
