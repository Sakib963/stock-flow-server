const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day, business_today } = require("../../../../utils/business-time");
const { ORDER_MONEY } = require("./order-money");

// The online rows of Customer dues, by courier: a delivered parcel whose money the courier collected
// and the business has not recorded. Built on the same orders and owed, so an advance order's rest
// counts too and the totals equal Customer dues narrowed to online.
const SQL = `
    WITH ${ORDER_MONEY("o.sold_on IS NOT NULL AND o.status <> 'Cancelled' AND o.payment_status <> 'paid' AND o.channel = 'ONLINE' AND 'ONLINE' = ANY($1)")}
    SELECT oo.courier, oo.consignment_no, f.invoice_no, to_char(${business_day("f.sold_on")}, 'YYYY-MM-DD') AS day,
           (${business_today} - ${business_day("f.sold_on")})::int AS days, f.customer_name AS customer, f.payment_type, f.owed::float AS to_collect
      FROM figures f
      JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = f.oid
     WHERE f.owed > 0
     ORDER BY oo.courier NULLS LAST, f.sold_on, f.invoice_no
     LIMIT $2`;

module.exports = {
    title: "COD with couriers",
    period: false,
    columns: [
        { key: "courier", label: "Courier", type: "courier" },
        { key: "consignment_no", label: "Consignment", type: "code" },
        { key: "invoice_no", label: "Invoice", type: "code" },
        { key: "day", label: "Delivered", type: "day" },
        { key: "days", label: "Days", type: "int" },
        { key: "customer", label: "Customer", type: "text" },
        { key: "payment_type", label: "Payment terms", type: "payment_type" },
        { key: "to_collect", label: "To collect", type: "money", total: true },
    ],
    read: ({ channels, limit }) => get_data({ text: SQL, values: [channels, limit] }),
    note: "As at now, by courier and oldest first. A parcel leaves this list once its payment is recorded on the order.",
};
