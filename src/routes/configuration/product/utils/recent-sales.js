const { get_data } = require("../../../../db/database");
const { business_today } = require("../../../../utils/business-time");
const { lines_cte } = require("../../../sales/analytics/utils/kept-sales");

const DAYS = 30;

// The last 30 business days, today included, picked by the database's own clock as every other
// period is, so the window cannot drift from the days the lines are read on.
const WINDOW_SQL = `SELECT to_char(${business_today} - ${DAYS - 1}, 'YYYY-MM-DD') AS date_from, to_char(${business_today}, 'YYYY-MM-DD') AS date_to`;

// The same kept-sales lines sales analytics and the reports read, narrowed to one product, so the three
// can never disagree. Units returned are those confirmed returns took back from these same sales.
const RECENT_SQL = `
      WITH ${lines_cte("AND oi.product_oid = $6")}
      SELECT COALESCE(SUM(quantity), 0)::int AS units_sold,
             COALESCE(SUM(returned_qty), 0)::int AS units_returned,
             COALESCE(SUM(quantity - returned_qty) FILTER (WHERE channel = 'POS'), 0)::int AS counter_units,
             COALESCE(SUM(quantity - returned_qty) FILTER (WHERE channel = 'ONLINE'), 0)::int AS online_units,
             COALESCE(SUM((unit_price - discount) * (quantity - returned_qty)), 0)::float8 AS sales,
             COALESCE(SUM(COALESCE(cost_price, 0) * (quantity - returned_qty)), 0)::float8 AS cost,
             COALESCE(SUM(quantity - returned_qty) FILTER (WHERE cost_price IS NULL), 0)::int AS units_without_cost
        FROM lines`;

// Sales value and profit only for someone who may see money.
const read_recent_sales = async (product_oid, { money }) => {
      const [{ date_from, date_to }] = await get_data({ text: WINDOW_SQL });
      const [row] = await get_data({ text: RECENT_SQL, values: [date_from, date_to, ["POS", "ONLINE"], null, null, product_oid] });
      const { sales, cost, units_without_cost, ...units } = row;
      return { days: DAYS, ...units, ...(money ? { sales, profit: sales - cost, units_without_cost } : {}) };
};

module.exports = { read_recent_sales };
