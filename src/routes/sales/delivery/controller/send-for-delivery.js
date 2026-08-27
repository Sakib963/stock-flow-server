const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { deductHeldStock } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Send for Delivery (dispatch). Available on CONFIRMED, not-yet-dispatched orders.
// Single (oid) or bulk (date range). Deducts the held stock exactly once, sets
// dispatched_on, and returns a Pathao-format export. Order stays CONFIRMED
// (dispatch is an action, not a state). After this the order can't be cancelled.
//
// Columns match Pathao's bulk-upload template. City/Zone/Area come from the
// structured delivery address captured at order time (Smart Fill + admin edit).
const PATHAO_COLUMNS = [
    "ItemType", "StoreName", "MerchantOrderId", "RecipientName(*)", "RecipientPhone(*)",
    "RecipientAddress(*)", "RecipientCity(*)", "RecipientZone(*)", "RecipientArea",
    "AmountToCollect(*)", "ItemQuantity", "ItemWeight", "ItemDesc", "SpecialInstruction",
];

const csvCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const send_for_delivery = async (request, res) => {
    const user_id = request.credentials.user_id;
    const { oid, date_from, date_to } = request.body;
    if (!oid && !date_from && !date_to) {
        return res.status(400).json({ code: 400, message: "Provide an order oid or a date range" });
    }

    try {
        const { invoice_nos, rows } = await execute_transaction(async (tx) => {
            // Select confirmed, not-yet-dispatched orders (lock rows to avoid double dispatch).
            const values = [];
            let where = `status = 'Confirmed' AND dispatched_on IS NULL AND channel = 'ONLINE'`;
            if (oid) { values.push(oid); where += ` AND oid = $${values.length}`; }
            if (date_from) { values.push(date_from); where += ` AND created_on::date >= $${values.length}`; }
            if (date_to) { values.push(date_to); where += ` AND created_on::date <= $${values.length}`; }

            const selected = await tx.get_data({
                text: `SELECT oid, invoice_no, customer_name, customer_phone, customer_address,
                              delivery_city, delivery_zone, delivery_area, payment_type,
                              CAST(total_amount AS INTEGER) AS total_amount, notes
                         FROM ${TABLE.ORDERS} WHERE ${where} ORDER BY created_on ASC FOR UPDATE`,
                values,
            });

            if (!selected.length) fail(404, "No confirmed, undispatched orders match");

            const rows = [];
            for (const o of selected) {
                const ded = await deductHeldStock(tx, { order_oid: o.oid, user_id });
                if (!ded.ok) fail(409, `Stock could not be deducted for ${o.invoice_no}. Nothing was dispatched.`);

                // Safety net: ensure a tracking token exists by dispatch time (COALESCE keeps
                // one minted at confirm). The label's QR needs it.
                await tx.execute_value({
                    text: `UPDATE ${TABLE.ORDERS} SET dispatched_on = clock_timestamp(), tracking_token = COALESCE(tracking_token, $3), edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2`,
                    values: [user_id, o.oid, crypto.randomBytes(16).toString("hex")],
                });
                await recordStatusHistory(tx, { order_oid: o.oid, from_status: "Confirmed", to_status: "Confirmed", reason: "Sent for delivery (dispatched)", user_id });

                const items = await tx.get_data({
                    text: `SELECT product_name, CAST(quantity AS INTEGER) AS quantity FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`,
                    values: [o.oid],
                });
                const qty = items.reduce((s, i) => s + Number(i.quantity), 0);
                const desc = items.map((i) => `${i.product_name} x${i.quantity}`).join("; ");
                const collect = o.payment_type === "PREPAID" ? 0 : o.total_amount;
                rows.push([
                    "parcel", "", o.invoice_no, o.customer_name, o.customer_phone,
                    o.customer_address, o.delivery_city || "", o.delivery_zone || "", o.delivery_area || "",
                    collect, qty, "", desc, o.notes || "",
                ]);
            }

            return { invoice_nos: selected.map((o) => o.invoice_no), rows };
        });

        const csv = [PATHAO_COLUMNS, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
        const file_name = `pathao-dispatch-${new Date().toISOString().slice(0, 10)}.csv`;

        saveLogActivity({ reference_type: "order", reference_oid: oid || "bulk", title: "Sent for Delivery", description: `Dispatched ${invoice_nos.length} order(s); stock deducted`, performed_by: user_id });
        log.info(`Sent for delivery: ${invoice_nos.length} order(s) by ${user_id}`);
        return res.status(200).json({
            code: 200,
            message: `${invoice_nos.length} order(s) sent for delivery`,
            data: { dispatched_count: invoice_nos.length, invoice_nos, file_name, csv },
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred during send-for-delivery: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = send_for_delivery;
