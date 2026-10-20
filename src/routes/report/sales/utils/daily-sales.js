const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");
const { ORDER_MONEY } = require("./order-money");

const SQL = `
    WITH ${ORDER_MONEY(`${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3)`)}
    SELECT to_char(${business_day("sold_on")}, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE kept_units > 0)::int AS sales_count,
           COALESCE(SUM(sales) FILTER (WHERE channel = 'POS'), 0)::float AS counter_sales,
           COALESCE(SUM(sales) FILTER (WHERE channel = 'ONLINE'), 0)::float AS online_sales,
           SUM(sales)::float AS sales, SUM(discount)::float AS discount, SUM(returns)::float AS returns, SUM(delivery)::float AS delivery,
           SUM(cost)::float AS cost, SUM(sales - cost)::float AS profit, SUM(units_without_cost)::int AS units_without_cost
      FROM figures
     GROUP BY 1
     ORDER BY 1
     LIMIT $4`;

const SUMMED = ["sales_count", "counter_sales", "online_sales", "sales", "discount", "returns", "delivery", "cost", "profit", "units_without_cost"];

module.exports = {
    title: "Daily sales",
    period: true,
    columns: [
        { key: "day", label: "Date", type: "day" },
        { key: "sales_count", label: "Sales", type: "int", total: true },
        { key: "counter_sales", label: "Counter", type: "money", total: true },
        { key: "online_sales", label: "Online", type: "money", total: true },
        { key: "sales", label: "Total sales", type: "money", total: true },
        { key: "discount", label: "Discount", type: "money", total: true },
        { key: "returns", label: "Returns", type: "money", total: true },
        { key: "delivery", label: "Delivery charges", type: "money", total: true },
        { key: "cost", label: "Cost", type: "money", total: true, cost: true },
        { key: "profit", label: "Profit", type: "money", total: true, cost: true },
    ],
    cost_totals: ["units_without_cost"],
    read: ({ period, channels, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] }),
    totals: (rows) => Object.fromEntries(SUMMED.map((key) => [key, sum(rows, key)])),
    note: "A return is taken off the day of its sale, so a closed day can still go down. Delivery charges are not sales: they pass to the courier.",
};
