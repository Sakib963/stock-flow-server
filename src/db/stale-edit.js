const { fail } = require("./database");

// The row's xmin, which every UPDATE changes whoever wrote it (decisions, 2026-10-26).
const VERSION = "xmin::text AS version";

// A version over some columns only, for a row two forms each save part of: saving one must not make
// the other look stale (the settings row).
const columns_version = (columns) => `md5(row(${columns.join(", ")})::text)`;

const refuse_stale = async (tx, { table, oid, version, gone, columns }) => {
    const [row] = await tx.get_data({ text: `SELECT ${columns ? columns_version(columns) : "xmin::text"} AS version FROM ${table} WHERE oid = $1 FOR UPDATE`, values: [oid] });
    if (!row) fail(404, gone);
    if (row.version !== version) fail(409, "Someone changed this after you opened it. Reload to see their change, then make yours again.", { reason: "changed_since_loaded" });
};

module.exports = { VERSION, columns_version, refuse_stale };
