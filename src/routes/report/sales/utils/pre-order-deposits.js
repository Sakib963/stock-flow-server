const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");

// Customer money held for stock not yet delivered: the advance kept on an open booking, and on a
// cancelled one the part still owed back. A converted booking's advance moved to its order.
const SQL = `
    SELECT to_char(${business_day("po.created_on")}, 'YYYY-MM-DD') AS day, po.preorder_no, c.name AS customer, c.phone, po.status AS pre_order_status,
           po.advance_paid::float AS advance_paid, po.advance_refunded::float AS advance_refunded,
           (CASE WHEN po.status = 'Cancelled' THEN GREATEST(po.advance_refund_due - po.advance_refunded, 0) ELSE po.advance_paid - po.advance_refunded END)::float AS held_money
      FROM ${TABLE.PRE_ORDERS} po
      LEFT JOIN ${TABLE.CUSTOMERS} c ON c.oid = po.customer_oid
     WHERE (po.status IN ('Pending', 'Confirmed') AND po.advance_paid > po.advance_refunded) OR (po.status = 'Cancelled' AND po.advance_refund_due > po.advance_refunded)
     ORDER BY po.created_on, po.preorder_no
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
