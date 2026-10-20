const { get_data } = require("../../../../db/database");
const { business_day, business_today } = require("../../../../utils/business-time");
const { PURCHASE_MONEY } = require("./purchase-money");

const SQL = `
    WITH received AS (${PURCHASE_MONEY("pu.payment_status IS DISTINCT FROM 'paid' AND ($1::text IS NULL OR pu.supplier_oid = $1)")})
    SELECT to_char(${business_day("verified_on")}, 'YYYY-MM-DD') AS day, (${business_today} - ${business_day("verified_on")})::int AS days,
           po_number, supplier, total::float, paid::float, (total - paid)::float AS owed, payment_status
      FROM received
     WHERE total > paid
     ORDER BY verified_on, po_number
     LIMIT $2`;

// Nothing in it is not buying money, so the whole report needs stock value access, not only columns.
module.exports = {
    title: "Supplier dues",
    period: false,
    requires: "inventory.stock-value.view",
    columns: [
        { key: "day", label: "Received", type: "day" },
        { key: "days", label: "Days", type: "int" },
        { key: "po_number", label: "Purchase order", type: "code" },
        { key: "supplier", label: "Supplier", type: "text" },
        { key: "total", label: "Total", type: "money", total: true },
        { key: "paid", label: "Paid", type: "money", total: true },
        { key: "owed", label: "Owed", type: "money", total: true },
        { key: "payment_status", label: "Payment status", type: "purchase_payment" },
    ],
    read: ({ query, limit }) => get_data({ text: SQL, values: [query.supplier_oid ?? null, limit] }),
    note: "As at now, oldest first: received purchase orders not fully paid, on the total recorded on the order.",
};
