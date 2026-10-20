const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");

// Customer money held for stock not yet delivered: the advance kept on an open booking, and on a
// cancelled one the part still owed back. A converted booking's advance moved to its order.
const SQL = `
    SELECT to_char(${business_day("created_on")}, 'YYYY-MM-DD') AS day, preorder_no, customer_name AS customer, customer_phone AS phone, status AS pre_order_status,
           advance_paid::float AS advance_paid, advance_refunded::float AS advance_refunded,
           (CASE WHEN status = 'Cancelled' THEN GREATEST(advance_refund_due - advance_refunded, 0) ELSE advance_paid - advance_refunded END)::float AS held_money
      FROM ${TABLE.PRE_ORDERS}
     WHERE (status IN ('Pending', 'Confirmed') AND advance_paid > advance_refunded) OR (status = 'Cancelled' AND advance_refund_due > advance_refunded)
     ORDER BY created_on, preorder_no
     LIMIT $1`;

module.exports = {
    title: "Pre-order deposits held",
    period: false,
    requires: "sales.pre-order.view",
    columns: [
        { key: "day", label: "Booked", type: "day" },
        { key: "preorder_no", label: "Pre-order", type: "code" },
        { key: "customer", label: "Customer", type: "text" },
        { key: "phone", label: "Phone", type: "code" },
        { key: "pre_order_status", label: "Status", type: "pre_order_status" },
        { key: "advance_paid", label: "Advance paid", type: "money", total: true },
        { key: "advance_refunded", label: "Refunded", type: "money", total: true },
        { key: "held_money", label: "Held or owed back", type: "money", total: true },
    ],
    read: ({ limit }) => get_data({ text: SQL, values: [limit] }),
    note: "As at now. On a cancelled pre-order, held is the advance still owed back to the customer.",
};
