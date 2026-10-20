const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { ORDER_MONEY } = require("../../sales/utils/order-money");

// Every customer, inactive ones too since they may still owe, with the record page's figures: sales
// are orders that kept something, bought is kept goods plus kept delivery, owed as Customer dues.
// First and last purchase come from sold_on, so a cancelled order is never a purchase.
const SQL = `
    WITH ${ORDER_MONEY("o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status <> 'Cancelled' AND o.channel = ANY($1)")},
    per AS (
        SELECT customer_oid,
               COUNT(*) FILTER (WHERE status <> 'Returned') AS sales,
               SUM(sales) + COALESCE(SUM(delivery) FILTER (WHERE status <> 'Returned'), 0) AS bought,
               SUM(owed) AS owed,
               MIN(sold_on) FILTER (WHERE status <> 'Returned') AS first_on,
               MAX(sold_on) FILTER (WHERE status <> 'Returned') AS last_on
          FROM figures GROUP BY customer_oid
    )
    SELECT c.name AS customer, c.phone, c.status AS customer_status,
           (SELECT d.name_en FROM ${TABLE.CUSTOMER_ADDRESS} a JOIN ${TABLE.DISTRICT} d ON d.oid = a.district_oid WHERE a.customer_oid = c.oid AND a.is_default ORDER BY a.oid LIMIT 1) AS district,
           c.gender, c.age_band, s.name AS first_source,
           COALESCE(p.sales, 0)::int AS sales,
           to_char(${business_day("p.first_on")}, 'YYYY-MM-DD') AS first_purchase, to_char(${business_day("p.last_on")}, 'YYYY-MM-DD') AS last_purchase,
           COALESCE(p.bought, 0)::float AS bought, COALESCE(p.owed, 0)::float AS owed
      FROM ${TABLE.CUSTOMERS} c
      LEFT JOIN per p ON p.customer_oid = c.oid
      LEFT JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = c.first_source_oid
     WHERE ($2::text IS NULL OR c.status = $2) AND ($3::text IS NULL OR c.gender = $3) AND ($4::text IS NULL OR c.age_band = $4)
     ORDER BY COALESCE(p.bought, 0) DESC, c.name, c.oid
     LIMIT $5`;

module.exports = {
    title: "Customer list",
    period: false,
    columns: [
        { key: "customer", label: "Customer", type: "text" },
        { key: "phone", label: "Phone", type: "code" },
        { key: "customer_status", label: "Status", type: "customer_status" },
        { key: "district", label: "District", type: "text", requires: "sales.online.view" },
        { key: "gender", label: "Gender", type: "gender" },
        { key: "age_band", label: "Age", type: "age_band" },
        { key: "first_source", label: "First source", type: "text" },
        { key: "sales", label: "Sales", type: "int", total: true },
        { key: "first_purchase", label: "First purchase", type: "day" },
        { key: "last_purchase", label: "Last purchase", type: "day" },
        { key: "bought", label: "Bought", type: "money", total: true },
        { key: "owed", label: "Owed", type: "money", total: true },
    ],
    read: ({ query, channels, limit }) => get_data({ text: SQL, values: [channels, query.status ?? null, query.gender ?? null, query.age_band ?? null, limit] }),
    note: "As at now, in the channels you sell through. Bought is what the customer kept, delivery included; owed matches Customer dues.",
};
