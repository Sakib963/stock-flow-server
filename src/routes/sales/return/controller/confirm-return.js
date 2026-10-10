const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { restockStock, incrementProductStat } = require("../../utils/stock-movement");
const { recordStatusHistory } = require("../../utils/order-utils");
const { channels_of } = require("../../utils/channels");
const { RETURNABLE_ORDER_STATUS, refundableNow } = require("../utils/return-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");
const { business_today } = require("../../../../utils/business-time");

// The condition can be corrected here, since this is when the goods are in hand. A counter refund is
// handed over at once (decided by the user, 2026-10-10); an online one becomes owed on the order.
const confirm_return = async (request, res) => {
    const { oid: return_oid, conditions = [], refund_method } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const channels = await channels_of(request);
        const outcome = await execute_transaction(async (tx) => {
            const [ret] = await tx.get_data({
                text: `SELECT pr.oid, pr.order_oid, pr.invoice_no AS return_no, pr.refund_amount::int AS refund_amount, pr.status, pr.return_reason, pr.refund_delivery_charge
                         FROM ${TABLE.PRODUCT_RETURN} pr JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
                        WHERE pr.oid = $1 AND o.channel = ANY($2) FOR UPDATE OF pr`,
                values: [return_oid, channels],
            });
            if (!ret) fail(404, "No return with that number.");
            if (ret.status !== "Pending") fail(409, `${ret.return_no} is already ${ret.status === "Returned" ? "confirmed" : "cancelled"}. Reload it to see what changed.`, { status: ret.status });

            const [order] = await tx.get_data({
                text: `SELECT o.oid, o.invoice_no, o.status, o.channel, o.payment_status, o.total_amount::int AS total_amount, o.amount_paid::int AS amount_paid,
                              o.amount_refunded::int AS amount_refunded, o.refund_due::int AS refund_due, o.refund_status, oo.delivery_status
                         FROM ${TABLE.ORDERS} o LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                        WHERE o.oid = $1 FOR UPDATE OF o`,
                values: [ret.order_oid],
            });
            const parcel = ret.return_reason === "not_delivered";
            const takes_return = parcel ? order.status === "Confirmed" && order.delivery_status === "Failed" : RETURNABLE_ORDER_STATUS.includes(order.status);
            if (!takes_return) fail(409, `${order.invoice_no} is ${order.status} and can no longer take this return.`);
            if (order.channel === "POS" && ret.refund_amount > 0 && !refund_method) fail(400, "Say how the money was handed back.");

            const lines = await tx.get_data({
                text: `SELECT rd.oid, rd.order_item_oid, rd.product_oid, rd.inventory_oid, rd.condition, rd.return_quantity::int AS return_quantity,
                              oi.product_name, oi.quantity::int AS sold_quantity, oi.returned_qty::int AS returned_qty
                         FROM ${TABLE.RETURN_DETAILS} rd JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
                        WHERE rd.return_oid = $1`,
                values: [return_oid],
            });
            const corrected = new Map(conditions.map((c) => [c.oid, c.condition]));
            if ([...corrected.keys()].some((oid) => !lines.some((l) => l.oid === oid))) fail(400, "A condition was given for a line that is not on this return.");
            for (const l of lines) {
                l.condition = corrected.get(l.oid) ?? l.condition;
                if (l.return_quantity > l.sold_quantity - l.returned_qty) fail(409, `Only ${Math.max(0, l.sold_quantity - l.returned_qty)} of "${l.product_name}" is left to return. Cancel this return and raise it again.`);
            }

            const damaged = lines.filter((l) => l.condition === "Damaged");
            let dispose_oid = null;
            if (damaged.length) {
                const costs = await tx.get_data({ text: `SELECT oid, cost_price::int AS cost_price FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`, values: [[...new Set(damaged.map((d) => d.inventory_oid))]] });
                const costOf = new Map(costs.map((r) => [r.oid, r.cost_price]));
                dispose_oid = uuidv4();
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE} (oid, dispose_no, disposal_date, disposal_method, total_dispose_quantity, total_dispose_value, notes, status, approved_by, approved_on, created_by)
                           VALUES ($1, $2, ${business_today}, 'destroyed', $3, $4, $5, 'Approved', $6, clock_timestamp(), $6)`,
                    values: [dispose_oid, `DISP-${ret.return_no}`, damaged.reduce((s, d) => s + d.return_quantity, 0), damaged.reduce((s, d) => s + d.return_quantity * (costOf.get(d.inventory_oid) || 0), 0), `Damaged customer return ${ret.return_no} on order ${order.invoice_no}`, user_id],
                });
                for (const d of damaged) {
                    await tx.execute_value({
                        text: `INSERT INTO ${TABLE.DISPOSE_DETAILS} (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by) VALUES ($1, $2, $3, $4, $5, 'damaged', $6, $7, $8)`,
                        values: [uuidv4(), dispose_oid, d.product_oid, d.inventory_oid, d.return_quantity, costOf.get(d.inventory_oid) || 0, `Return ${ret.return_no}`, user_id],
                    });
                }
            }

            let restocked = 0;
            for (const l of lines) {
                const good = l.condition === "Good";
                await tx.execute_value({ text: `UPDATE ${TABLE.RETURN_DETAILS} SET condition = $1, action = $2, dispose_oid = $3 WHERE oid = $4`, values: [l.condition, good ? "Restocked" : "Disposed", good ? null : dispose_oid, l.oid] });
                const raised = await tx.execute_value({ text: `UPDATE ${TABLE.ORDER_ITEMS} SET returned_qty = returned_qty + $1 WHERE oid = $2 AND quantity - returned_qty >= $1`, values: [l.return_quantity, l.order_item_oid] });
                if (raised.rowCount !== 1) fail(409, `"${l.product_name}" was returned by someone else at the same moment. Reload the return.`);
                if (good) {
                    await restockStock(tx, { inventory_oid: l.inventory_oid, quantity: l.return_quantity, reason: "returned", source_oid: return_oid, user_id });
                    restocked += l.return_quantity;
                }
                // A parcel that never arrived was never sold, so it is not a return of a sale either.
                if (!parcel || !good) await incrementProductStat(tx, { product_oid: l.product_oid, column: good ? "total_returned" : "total_damaged", quantity: l.return_quantity, user_id });
            }

            const settled = await tx.execute_value({ text: `UPDATE ${TABLE.PRODUCT_RETURN} SET status = 'Returned', edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2 AND status = 'Pending'`, values: [user_id, return_oid] });
            if (settled.rowCount !== 1) fail(409, `${ret.return_no} was confirmed or cancelled by someone else. Reload it to see what changed.`);

            const [{ remaining }] = await tx.get_data({ text: `SELECT COALESCE(SUM(quantity - returned_qty), 0)::int AS remaining FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order.oid] });
            // It gave the delivery charge back because the rest was on another return; if that one was cancelled, it is no longer the whole order.
            if (ret.refund_delivery_charge && remaining > 0) fail(409, `${ret.return_no} gives the delivery charge back, but part of the order is no longer coming back. Cancel this return and raise it again.`);
            const order_status = remaining === 0 ? "Returned" : "PartiallyReturned";
            const moved = await tx.execute_value({ text: `UPDATE ${TABLE.ORDERS} SET status = $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND status = $4`, values: [order_status, user_id, order.oid, order.status] });
            if (moved.rowCount !== 1) fail(409, `${order.invoice_no} changed while the return was being confirmed. Reload it and try again.`);
            await recordStatusHistory(tx, { order_oid: order.oid, from_status: order.status, to_status: order_status, reason: ret.return_no, user_id });
            if (parcel) {
                await tx.execute_value({ text: `UPDATE ${TABLE.ONLINE_ORDER} SET delivery_status = 'BackInShop', edited_by = $1, edited_on = clock_timestamp() WHERE order_oid = $2`, values: [user_id, order.oid] });
                await recordStatusHistory(tx, { order_oid: order.oid, kind: "Delivery", from_status: "Failed", to_status: "BackInShop", reason: ret.return_no, user_id });
            }

            // Another return or refund may have taken money since this one was raised; it never gives back more than is held.
            const refund = Math.min(ret.refund_amount, refundableNow(order, 0));
            if (refund !== ret.refund_amount) await tx.execute_value({ text: `UPDATE ${TABLE.PRODUCT_RETURN} SET refund_amount = $1 WHERE oid = $2`, values: [refund, return_oid] });
            if (refund > 0 && order.channel === "POS") {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.ORDERS}
                              SET amount_refunded = amount_refunded + $1, refund_status = 'Refunded',
                                  payment_status = CASE WHEN amount_paid - amount_refunded - $1 <= 0 THEN 'refunded' ELSE 'partially_refunded' END
                            WHERE oid = $2`,
                    values: [refund, order.oid],
                });
                await recordStatusHistory(tx, { order_oid: order.oid, kind: "Refund", from_status: order.refund_status, to_status: "Refunded", reason: `${refund} by ${refund_method}`, user_id });
            } else if (refund > 0) {
                await tx.execute_value({ text: `UPDATE ${TABLE.ORDERS} SET refund_due = refund_due + $1, refund_status = 'ToRefund' WHERE oid = $2`, values: [refund, order.oid] });
                await recordStatusHistory(tx, { order_oid: order.oid, kind: "Refund", from_status: order.refund_status, to_status: "ToRefund", reason: String(refund), user_id });
            }

            const disposed = damaged.reduce((s, d) => s + d.return_quantity, 0);
            const summary = `${ret.return_no}: ${restocked} unit(s) restocked${disposed ? `, ${disposed} damaged unit(s) disposed` : ""}${refund ? `, refund ${refund}${order.channel === "POS" ? ` handed back by ${refund_method}` : " owed"}` : ""}`;
            await saveLogActivity({ reference_type: "order", reference_oid: order.oid, title: "Return confirmed", description: `${summary}. Order is now ${order_status}` }, { tx, request });
            // The stock movement analytics and the activity log filter read returns under their own type.
            await saveLogActivity({ reference_type: "product-return", reference_oid: return_oid, title: "Return confirmed", description: summary }, { tx, request });
            return { return_no: ret.return_no, order_status, dispose_oid, restocked_units: restocked, disposed_units: disposed, refund_amount: refund };
        });
        log.info(`Return ${outcome.return_no} confirmed by ${user_id}; order now ${outcome.order_status}`);
        return res.status(200).json({ code: 200, message: "Return confirmed", data: outcome });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while confirming a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The return was not confirmed. Try again in a moment." });
    }
};

module.exports = confirm_return;
