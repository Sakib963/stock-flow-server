const { business_day_start } = require("../../../../utils/business-time");

// Pieces every analytics statement shares, so the tabs cannot drift apart on a period or a shape.

/** A stored time within the period's business days: $1 first day, $2 last day, both inclusive. */
const IN_PERIOD = (column) => `${column} >= ${business_day_start("$1")} AND ${column} < ${business_day_start("$2::date + 1")}`;

/** One row, or a list of rows, of a figure's query as JSON, so a tab's figures come back in one statement. */
const json_row = (sql) => `(SELECT row_to_json(x) FROM (${sql}) x)`;
const json_rows = (sql) => `(SELECT COALESCE(json_agg(x), '[]'::json) FROM (${sql}) x)`;

module.exports = { IN_PERIOD, json_row, json_rows };
