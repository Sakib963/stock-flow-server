const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { business_day, business_today, business_day_start } = require("../../../../utils/business-time");
const { PLAN_BYTES } = require("../utils/thresholds");

const get_database_status = async (request, res) => {
    try {
        const [[sizes], tables, daily] = await Promise.all([
            get_data({
                text: `SELECT pg_database_size(current_database())::float8 AS database_bytes, current_setting('max_connections')::int AS max_connections,
                              (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections`,
            }),
            get_data({
                text: `SELECT c.relname AS name, pg_total_relation_size(c.oid)::float8 AS bytes, GREATEST(c.reltuples, 0)::float8 AS rows
                         FROM pg_class c WHERE c.relname = ANY($1) AND c.relkind = 'r'`,
                values: [[TABLE.API_REQUEST_LOG, TABLE.ACTIVITY_LOG]],
            }),
            get_data({
                text: `SELECT to_char(${business_day("occurred_on")}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS requests
                         FROM ${TABLE.API_REQUEST_LOG} WHERE occurred_on >= ${business_day_start(`${business_today} - 29`)} GROUP BY 1 ORDER BY 1`,
            }),
        ]);
        const log_table = tables.find((t) => t.name === TABLE.API_REQUEST_LOG);
        // The database does not track bytes per day, so they are estimated from the log's average row.
        const bytes_per_row = log_table?.rows > 0 ? log_table.bytes / log_table.rows : 0;
        const per_day = daily.map((d) => ({ ...d, bytes: Math.round(d.requests * bytes_per_row) }));
        const average_bytes_per_day = per_day.length ? per_day.reduce((sum, d) => sum + d.bytes, 0) / per_day.length : 0;
        return res.status(200).json({ code: 200, message: "Database", data: { ...sizes, plan_bytes: PLAN_BYTES, tables, daily: per_day, average_bytes_per_day } });
    } catch (e) {
        log.error(`An exception occurred while reading the database status: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the database status. Try again in a moment." });
    }
};

module.exports = get_database_status;
