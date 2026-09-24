const { Pool } = require("pg");
// ENV_FILE lets a local dev point at a different env (e.g. ./src/env/.env.local)
// without touching the committed cloud .env. Defaults to the cloud env.
require("dotenv").config({ path: process.env.ENV_FILE || `./src/env/.env` });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 5, // Reduced for serverless (Vercel creates multiple instances)
  min: 0, // Allow scaling down to 0 for serverless
  idleTimeoutMillis: 60000, // 60 seconds before closing idle connections
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

// Handle pool errors to prevent crashes
pool.on("error", (err, client) => {
  console.error("❌ Unexpected error on idle client", err);
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
