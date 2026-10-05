const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory, nextInvoiceNo } = require("../../utils/order-utils");
const { price_lines, cart_totals, insert_lines } = require("../../utils/cart");
const { normalize_phone } = require("../../utils/phone");

// The address part a draft keeps: a saved address by its oid, or a new one copied as typed. Nothing is
// saved to a customer until the order is created.
// A saved address is copied only when it belongs to the customer behind the draft's phone.
const address_copy = async (tx, address, phone) => {
    if (!address) return {};
    if (address.oid) {
        const [saved] = await tx.get_data({
            text: `SELECT a.oid AS customer_address_oid, a.recipient_name, a.recipient_phone, a.address_line, a.district_oid, a.thana_oid, a.area_text, a.postal_code
                     FROM ${TABLE.CUSTOMER_ADDRESS} a JOIN ${TABLE.CUSTOMERS} c ON c.oid = a.customer_oid
                    WHERE a.oid = $1 AND a.status = 'Active' AND c.phone_normalized = $2`,
            values: [address.oid, normalize_phone(phone ?? "")],
        });
        return saved ?? {};
    }
    return { customer_address_oid: null, ...address };
};

// A half-made online order (sales REQ-42): a Draft on the spine, with its lines priced from the
// batches and the address as far as it was typed. It holds no stock and creates no customer, so a
// chat that never finishes leaves nothing behind. Saving the same draft again updates it.
const save_online_draft = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    try {
        const saved = await execute_transaction(async (tx) => {
            const lines = await price_lines(tx, payload.lines);
            const totals = cart_totals(lines);
            const total_amount = totals.total_amount + payload.delivery_charge;
            const header = [payload.draft_label, payload.customer.name, payload.customer.phone, totals.subtotal, totals.discount_total, payload.delivery_charge, total_amount, payload.payment_type, payload.notes, user_id];

            const order_oid = payload.oid;
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET draft_label = $1, customer_name = $2, customer_phone = $3, subtotal = $4, discount_total = $5, delivery_charge = $6, total_amount = $7,
                              payment_type = $8, notes = $9, edited_by = $10, edited_on = clock_timestamp()
                        WHERE oid = $11 AND channel = 'ONLINE' AND status = 'Draft'
                    RETURNING invoice_no`,
                values: [...header, order_oid],
            });
            let invoice_no = updated.rows[0]?.invoice_no;
            if (updated.rowCount === 1) {
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ONLINE_ORDER} WHERE order_oid = $1`, values: [order_oid] });
            } else {
                invoice_no = await nextInvoiceNo(tx.get_data);
                const created = await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS} (draft_label, customer_name, customer_phone, subtotal, discount_total, delivery_charge, total_amount, payment_type, notes, created_by, oid, invoice_no, channel, status, payment_status)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ONLINE', 'Draft', 'unpaid')
                           ON CONFLICT (oid) DO NOTHING`,
                    values: [...header, order_oid, invoice_no],
                });
                if (created.rowCount !== 1) fail(409, "This order was already placed or discarded, so the draft was not saved.");
                await recordStatusHistory(tx, { order_oid, from_status: null, to_status: "Draft", reason: "Online draft saved", user_id });
            }

            const address = await address_copy(tx, payload.address, payload.customer.phone);
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.ONLINE_ORDER} (order_oid, customer_address_oid, recipient_name, recipient_phone, address_line, district_oid, thana_oid, area_text, postal_code, source_oid, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                values: [order_oid, address.customer_address_oid ?? null, address.recipient_name ?? null, address.recipient_phone ?? null, address.address_line ?? null, address.district_oid ?? null, address.thana_oid ?? null, address.area_text ?? null, address.postal_code ?? null, payload.source_oid, user_id],
            });
            await insert_lines(tx, order_oid, lines);

            const label = payload.draft_label ? ` "${payload.draft_label}"` : "";
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: updated.rowCount === 1 ? "Updated online draft" : "Saved online draft", description: `${invoice_no}${label}, ${lines.length} line(s)` }, { tx, request });
            return { oid: order_oid, invoice_no };
        });

        log.info(`Online draft ${saved.invoice_no} saved by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Draft saved", data: saved });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while saving an online draft: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The draft was not saved. Try again in a moment." });
    }
};

module.exports = save_online_draft;
