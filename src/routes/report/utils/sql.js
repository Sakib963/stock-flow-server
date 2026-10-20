const { business_day_start } = require("../../../utils/business-time");

/** A stored time within the period's business days: $1 first day, $2 last day, both inclusive. */
const IN_PERIOD = (column) => `${column} >= ${business_day_start("$1")} AND ${column} < ${business_day_start("$2::date + 1")}`;

module.exports = { IN_PERIOD };
