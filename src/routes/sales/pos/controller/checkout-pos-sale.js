const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { deductSellableStock, incrementProductStat } = require("../../utils/stock-movement");
const { recordStatusHistory, nextInvoiceNo, resolveAmountPaid } = require("../../utils/order-utils");
const { find_or_create_customer } = require("../../customer/utils/find-or-create");
const { price_lines, cart_totals, insert_lines, batch_name } = require("../../utils/cart");

const sellable_of = async (tx, inventory_oid) => {
    const [row] = await tx.get_data({
        text: `SELECT (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS sellable
                 FROM ${TABLE.INVENTORY} i WHERE i.oid = $1`,
        values: [inventory_oid],
    });
    return Math.max(row?.sellable ?? 0, 0);
};

const refuse_existing = async (tx, oid) => {
    const [order] = await tx.get_data({ text: `SELECT invoice_no, status FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [oid] });
    if (order?.status === "Cancelled") fail(409, "This cart was discarded at another counter.", { invoice_no: order.invoice_no, status: order.status });
    fail(409, `This sale is already recorded as ${order?.invoice_no}. Nothing was charged twice.`, { invoice_no: order?.invoice_no, status: order?.status });
};

// A POS sale: priced from the batches, stock deducted from each exact batch at once (no hold), and
// sold_on set in the same transaction (sales REQ-17, REQ-23, REQ-120). A parked cart held nothing
// while it waited, so its stock is checked now (REQ-24).
const checkout_pos_sale = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    try {
        const sale = await execute_transaction(async (tx) => {
            const lines = await price_lines(tx, payload.lines);
            const totals = cart_totals(lines);
            if (totals.total_amount !== payload.total_amount) {
                // Each line's price now, so the page can show the cart the server will accept instead of refusing it again.
                fail(409, `The total is now ${totals.total_amount}, not ${payload.total_amount}. A price changed: check the cart and confirm again.`, {
                    total_amount: totals.total_amount,
                    lines: lines.map((l) => ({ inventory_oid: l.inventory_oid, unit_price: l.unit_price })),
                });
            }

            const customer = payload.customer ? await find_or_create_customer(tx, payload.customer, request) : null;
            const payment_status = payload.payment_status;
            const amount_paid = resolveAmountPaid({ payment_status, total_amount: totals.total_amount, amount_paid: payload.amount_paid });
            if (payment_status === "partially_paid" && amount_paid === totals.total_amount) {
                fail(400, `That covers the whole total of ${totals.total_amount}. Mark the sale paid instead.`, { field: "amount_paid" });
            }
            const header = [customer?.oid ?? null, customer?.name ?? null, customer?.phone ?? null, totals.subtotal, totals.discount_total, totals.total_amount, amount_paid, payload.payment_method, payload.payment_reference, payment_status, payload.notes, user_id];

            // The page names every sale with its own oid: a parked cart's, or a new one per cart. A
            // checkout pressed again after a lost answer, or at a second counter, then finds the sale
            // already made and is refused instead of selling twice.
            const order_oid = payload.oid;
            const parked = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET customer_oid = $1, customer_name = $2, customer_phone = $3, subtotal = $4, discount_total = $5, total_amount = $6, amount_paid = $7,
                              payment_method = $8, payment_reference = $9, payment_status = $10, notes = $11, edited_by = $12, edited_on = clock_timestamp(),
                              status = 'Purchased', sold_on = clock_timestamp(), draft_label = NULL
                        WHERE oid = $13 AND channel = 'POS' AND status = 'Draft' AND sold_on IS NULL
                    RETURNING invoice_no`,
                values: [...header, order_oid],
            });
            let invoice_no = parked.rows[0]?.invoice_no;
            if (parked.rowCount === 1) {
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
            } else {
                invoice_no = await nextInvoiceNo(tx.get_data);
                const created = await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS}
                               (customer_oid, customer_name, customer_phone, subtotal, discount_total, total_amount, amount_paid,
                                payment_method, payment_reference, payment_status, notes, created_by, oid, invoice_no, channel, delivery_charge, status, sold_on)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'POS', 0, 'Purchased', clock_timestamp())
                           ON CONFLICT (oid) DO NOTHING`,
                    values: [...header, order_oid, invoice_no],
                });
                if (created.rowCount !== 1) await refuse_existing(tx, order_oid);
            }

            await insert_lines(tx, order_oid, lines);
            // Batches in one order, so two counters selling the same two batches cannot each wait on the other.
            for (const line of [...lines].sort((a, b) => a.inventory_oid.localeCompare(b.inventory_oid))) {
                const deducted = await deductSellableStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, order_oid, user_id });
                if (!deducted) {
                    const left = await sellable_of(tx, line.inventory_oid);
                    fail(409, `Only ${left} left of ${batch_name(line)}. Reduce or remove the line.`, { inventory_oid: line.inventory_oid, sellable: left });
                }
                await incrementProductStat(tx, { product_oid: line.product_oid, column: "total_sold", quantity: line.quantity, user_id });
            }

            await recordStatusHistory(tx, { order_oid, from_status: parked.rowCount === 1 ? "Draft" : null, to_status: "Purchased", reason: parked.rowCount === 1 ? "Parked cart checked out" : "POS checkout", user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Sold at the counter", description: `${invoice_no}, ${lines.length} line(s), total ${totals.total_amount}` }, { tx, request });
            return { oid: order_oid, invoice_no, customer_oid: customer?.oid ?? null, total_amount: totals.total_amount, amount_paid };
        });

        log.info(`POS sale ${sale.invoice_no} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Sale completed", data: sale });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred during POS checkout: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The sale was not saved and no stock was taken. Try again in a moment." });
    }
};

module.exports = checkout_pos_sale;
