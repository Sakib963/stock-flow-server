const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day, business_day_start, business_today } = require("../../../../utils/business-time");
const { ORDER_MONEY } = require("../../sales/utils/order-money");

// Customers whose last kept sale is older than the chosen days (90 when none is given) and who have no
// order on its way: someone waiting for a parcel is not lost.
const SQL = `
    WITH ${ORDER_MONEY("o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status NOT IN ('Cancelled', 'Returned') AND o.channel = ANY($1)")},
    per AS (SELECT customer_oid, MAX(sold_on) AS last_on, COUNT(*) AS sales, SUM(sales + delivery) AS bought FROM figures GROUP BY customer_oid)
    SELECT c.name AS customer, c.phone, to_char(${business_day("p.last_on")}, 'YYYY-MM-DD') AS last_purchase,
           (${business_today} - ${business_day("p.last_on")})::int AS days, p.sales::int AS sales, p.bought::float AS bought
      FROM per p
      JOIN ${TABLE.CUSTOMERS} c ON c.oid = p.customer_oid
     WHERE p.last_on < ${business_day_start(`${business_today} - COALESCE($2::int, 90)`)}
       AND NOT EXISTS (SELECT 1 FROM ${TABLE.ORDERS} o WHERE o.customer_oid = c.oid AND o.sold_on IS NULL AND o.status NOT IN ('Draft', 'Cancelled'))
     ORDER BY p.bought DESC, c.name, c.oid
     LIMIT $3`;

module.exports = {
    title: "Customers gone quiet",
    period: false,
    columns: [
        { key: "customer", label: "Customer", type: "text" },
        { key: "phone", label: "Phone", type: "code" },
        { key: "last_purchase", label: "Last purchase", type: "day" },
        { key: "days", label: "Days", type: "int" },
        { key: "sales", label: "Sales", type: "int", total: true },
        { key: "bought", label: "Bought", type: "money", total: true },
    ],
    read: ({ query, channels, limit }) => get_data({ text: SQL, values: [channels, query.quiet_days ?? null, limit] }),
    note: "As at now, the customers worth most first. A customer with an order on its way is not listed.",
};
