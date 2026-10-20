const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");

// Confirmed returns, dated when confirmed: edited_on is written once, by the guarded move from
// Pending, and a confirmed return is never edited again. A parcel that never reached the customer
// (Not delivered) is left out: it was never a sale, so it gives nothing back to any sales figure.
const SQL = `
    SELECT to_char(${business_day("pr.edited_on")}, 'YYYY-MM-DD') AS day, pr.invoice_no AS return_no, o.invoice_no, o.customer_name AS customer, pr.return_reason AS reason,
           COALESCE(SUM(rd.return_quantity) FILTER (WHERE rd.condition IS DISTINCT FROM 'Damaged'), 0)::int AS units_restocked,
           COALESCE(SUM(rd.return_quantity) FILTER (WHERE rd.condition = 'Damaged'), 0)::int AS units_damaged,
           COALESCE(SUM(rd.return_quantity * (oi.unit_price - COALESCE(oi.discount, 0))), 0)::float AS value,
           pr.refund_amount::float AS refund,
           (CASE WHEN pr.refund_delivery_charge THEN o.delivery_charge ELSE 0 END)::float AS delivery_refunded
      FROM ${TABLE.PRODUCT_RETURN} pr
      JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
      LEFT JOIN ${TABLE.RETURN_DETAILS} rd ON rd.return_oid = pr.oid
      LEFT JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
     WHERE pr.status = 'Returned' AND pr.return_reason <> 'not_delivered' AND ${IN_PERIOD("pr.edited_on")} AND o.channel = ANY($3)
     GROUP BY pr.oid, pr.edited_on, pr.invoice_no, o.invoice_no, o.customer_name, pr.return_reason, pr.refund_amount, pr.refund_delivery_charge, o.delivery_charge
     ORDER BY pr.edited_on, pr.invoice_no
     LIMIT $4`;

module.exports = {
    title: "Returns",
    period: true,
    columns: [
        { key: "day", label: "Confirmed", type: "day" },
        { key: "return_no", label: "Return", type: "code" },
        { key: "invoice_no", label: "Invoice", type: "code" },
        { key: "customer", label: "Customer", type: "text" },
        { key: "reason", label: "Reason", type: "return_reason" },
        { key: "units_restocked", label: "Back on the shelf", type: "int", total: true },
        { key: "units_damaged", label: "Damaged", type: "int", total: true },
        { key: "value", label: "Value", type: "money", total: true },
        { key: "refund", label: "Refund", type: "money", total: true },
        { key: "delivery_refunded", label: "Delivery charge refunded", type: "money", total: true },
    ],
    read: ({ period, channels, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] }),
    note: "Dated when the return was confirmed. Value beyond the refund lowered what the customer owed. Damaged units also appear in Disposals; their stock left at the sale. Parcels that never reached the customer are not here.",
};
