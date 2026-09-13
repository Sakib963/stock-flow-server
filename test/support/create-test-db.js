// Rebuilds the test database from generated_schema.sql before every run, so the suite always starts
// from the shape a brand new client database would have, and a stale schema file fails here first.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env.test") });

const SCHEMA = path.resolve(__dirname, "../../../stock-flow-documents/generated_schema.sql");

(async () => {
    const name = process.env.DB_NAME;

    // This drops the database it is pointed at, so it refuses anything but a local *_test one.
    if (!/_test$/.test(name) || !["localhost", "127.0.0.1"].includes(process.env.DB_HOST)) {
        throw new Error(`Refusing to rebuild "${name}" on "${process.env.DB_HOST}". Tests only run against a local *_test database.`);
    }

    const connection = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD };

    const admin = new Client({ ...connection, database: "postgres" });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();

    const db = new Client({ ...connection, database: name });
    await db.connect();
    await db.query(fs.readFileSync(SCHEMA, "utf8"));
    const { rows } = await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    await db.end();

    console.log(`Rebuilt ${name} from generated_schema.sql: ${rows[0].n} tables.`);
})().catch((e) => {
    console.error(`Could not build the test database: ${e.message}`);
    console.error("Is the local Postgres running? See test/README.md.");
    process.exit(1);
});
