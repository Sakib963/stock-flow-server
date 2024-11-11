const { Pool } = require('pg');
require("dotenv").config({ path: `./src/env/.env` });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    maxUses: 7500,
    ssl: { rejectUnauthorized: false }
});

module.exports = pool;
