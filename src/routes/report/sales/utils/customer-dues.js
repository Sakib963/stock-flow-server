const { get_data } = require("../../../../db/database");
const { business_day, business_today } = require("../../../../utils/business-time");
const { ORDER_MONEY } = require("./order-money");

// As at now, the orders customer-history counts as owed, so one customer's rows add up to the owed on
// their record page. A walk-in sale has no customer record to compare against.
const SQL = `
    WITH ${ORDER_MONEY("o.sold_on IS NOT NULL AND o.status <> 'Cancelled' AND o.payment_status <> 'paid' AND o.channel = ANY($1)")}
    SELECT to_char(${business_day("sold_on")}, 'YYYY-MM-DD') AS day, (${business_today} - ${business_day("sold_on")})::int AS days,
           invoice_no, customer_name AS customer, customer_phone AS phone, channel, payment_type, payment_status,
           customer_total::float, received::float, owed::float
      FROM figures
     WHERE owed > 0
     ORDER BY sold_on, invoice_no
     LIMIT $2`;

module.exports = {
    title: "Customer dues",
    period: false,
    columns: [
        { key: "day", label: "Sold on", type: "day" },
        { key: "days", label: "Days", type: "int" },
        { key: "invoice_no", label: "Invoice", type: "code" },
        { key: "customer", label: "Customer", type: "text" },
        { key: "phone", label: "Phone", type: "code" },
        { key: "channel", label: "Channel", type: "channel" },
        { key: "payment_type", label: "Payment terms", type: "payment_type" },
        { key: "payment_status", label: "Payment status", type: "payment_status" },
        { key: "customer_total", label: "Customer total", type: "money", total: true },
        { key: "received", label: "Received", type: "money", total: true },
        { key: "owed", label: "Owed", type: "money", total: true },
    ],
    read: ({ channels, limit }) => get_data({ text: SQL, values: [channels, limit] }),
    note: "As at now, oldest first. A COD parcel shows here until the courier's payment is recorded. Received is what the business keeps of what was paid.",
};
