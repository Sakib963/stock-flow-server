const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");
const { ORDER_MONEY } = require("./order-money");

// Every order that became a sale in the period, a fully returned one included: it kept nothing of
// its goods but may have kept its delivery charge and money, which the received and owed totals
// must show. The sales count counts only orders that kept something, as analytics does.
const SQL = `
    WITH ${ORDER_MONEY(`${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3)`)}
    SELECT to_char(${business_day("sold_on")}, 'YYYY-MM-DD') AS day, invoice_no, channel, customer_name AS customer, payment_method, payment_status,
           goods::float, discount::float, returns::float, sales::float, delivery::float, customer_total::float, received::float, owed::float,
           cost::float, (sales - cost)::float AS profit, kept_units::int, units_without_cost::int
      FROM figures
     ORDER BY sold_on, invoice_no
     LIMIT $4`;

module.exports = {
    title: "Sales register",
    period: true,
    columns: [
        { key: "day", label: "Date", type: "day" },
        { key: "invoice_no", label: "Invoice", type: "code" },
        { key: "channel", label: "Channel", type: "channel" },
        { key: "customer", label: "Customer", type: "text" },
        { key: "payment_method", label: "Payment method", type: "payment_method" },
        { key: "goods", label: "Goods at list price", type: "money", total: true },
        { key: "discount", label: "Discount", type: "money", total: true },
        { key: "returns", label: "Returns", type: "money", total: true },
        { key: "sales", label: "Sales", type: "money", total: true },
        { key: "delivery", label: "Delivery charge", type: "money", total: true },
        { key: "customer_total", label: "Customer total", type: "money", total: true },
        { key: "received", label: "Received", type: "money", total: true },
        { key: "owed", label: "Owed", type: "money", total: true },
        { key: "payment_status", label: "Payment status", type: "payment_status" },
        { key: "cost", label: "Cost", type: "money", total: true, cost: true },
        { key: "profit", label: "Profit", type: "money", total: true, cost: true },
    ],
    cost_totals: ["units_without_cost"],
    read: ({ period, channels, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] }),
    totals: (rows) => ({
        ...Object.fromEntries(["goods", "discount", "returns", "sales", "delivery", "customer_total", "received", "owed", "cost", "profit", "units_without_cost"].map((key) => [key, sum(rows, key)])),
        sales_count: rows.filter((row) => row.kept_units > 0).length,
    }),
    note: "A return is taken off the day of its sale, so a closed month can still go down. Delivery charges are not sales: they pass to the courier.",
};
