const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const pool = require("../../src/db/db.config");
const { get_data } = require("../../src/db/database");

before(h.start);
after(h.stop);

describe("connections a frozen server copy leaves open are closed by the database", () => {
    it("every server connection asks the database to close it after 30 idle seconds", async () => {
        const [row] = await get_data({ text: "SHOW idle_session_timeout" });
        assert.equal(row.idle_session_timeout, "30s");
    });

    it("answers the next request after the database has closed an idle connection", async () => {
        const client = await pool.connect();
        await client.query("SET idle_session_timeout = '100ms'");
        client.release();
        await new Promise((resolve) => setTimeout(resolve, 400));

        const [row] = await get_data({ text: "SELECT 1 AS ok" });
        assert.equal(row.ok, 1);
    });
});
