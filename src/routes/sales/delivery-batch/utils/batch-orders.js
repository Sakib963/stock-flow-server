const { TABLE } = require("../../../../utils/constant");

// Ready to send (delivery batch, Definitions): an online order confirmed and not yet with a courier.
const READY = `(o.channel = 'ONLINE' AND o.status = 'Confirmed' AND o.dispatched_on IS NULL AND oo.delivery_status IN ('Preparing', 'Packed'))`;
const IN_A_BATCH = `EXISTS (SELECT 1 FROM ${TABLE.DELIVERY_BATCH_ORDER} bo WHERE bo.order_oid = o.oid AND bo.active)`;

// What the courier collects (sales REQ-116): the total less the effective amount paid.
const TO_COLLECT = `GREATEST(o.total_amount - CASE o.payment_status WHEN 'paid' THEN o.total_amount WHEN 'unpaid' THEN 0 ELSE o.amount_paid END, 0)::bigint`;

// One order as a batch shows, labels and exports it: the recipient, where it goes in English, and
// what is in the parcel. English names, because the label and the courier's file are English.
const ORDER_COLUMNS = `o.oid, o.invoice_no, o.status, o.created_on, o.notes, o.tracking_token, o.dispatched_on,
       oo.delivery_status, oo.courier, oo.consignment_no,
       COALESCE(NULLIF(oo.recipient_name, ''), o.customer_name) AS recipient_name, COALESCE(NULLIF(oo.recipient_phone, ''), o.customer_phone) AS recipient_phone,
       oo.address_line, oo.area_text, oo.postal_code, d.name_en AS district, t.name_en AS thana,
       i.units, i.items, ${TO_COLLECT} AS to_collect, ${READY} AS ready`;

const ORDER_FROM = `${TABLE.ORDERS} o
       JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
       LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
       LEFT JOIN ${TABLE.THANA} t ON t.oid = oo.thana_oid
       LEFT JOIN LATERAL (
            -- Per product, not per line: one product sold from two batches is one entry for the courier.
            SELECT COALESCE(SUM(l.quantity), 0)::int AS units, string_agg(l.name || ' x' || l.quantity, '; ' ORDER BY l.name) AS items
              FROM (SELECT p.name, SUM(oi.quantity)::int AS quantity
                      FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
                     WHERE oi.order_oid = o.oid
                     GROUP BY p.oid, p.name) l) i ON true`;

// Pathao's bulk upload, the columns in its own order (REQ-06). Store name and weight are optional
// there and stay empty until Pathao asks for them.
const PATHAO_COLUMNS = ["ItemType", "StoreName", "MerchantOrderId", "RecipientName(*)", "RecipientPhone(*)", "RecipientAddress(*)", "RecipientCity(*)", "RecipientZone(*)", "RecipientArea", "AmountToCollect(*)", "ItemQuantity", "ItemWeight", "ItemDesc", "SpecialInstruction"];

const pathaoRow = (order) => ["parcel", "", order.invoice_no, order.recipient_name, order.recipient_phone, order.address_line, order.district, order.thana, order.area_text, Number(order.to_collect), order.units, "", order.items, order.notes];

const csvCell = (value) => {
    const text = value === null || value === undefined ? "" : String(value).replace(/\r?\n/g, " ");
    return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const pathaoCsv = (orders) => [PATHAO_COLUMNS, ...orders.map(pathaoRow)].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

module.exports = { READY, IN_A_BATCH, TO_COLLECT, ORDER_COLUMNS, ORDER_FROM, pathaoCsv };
