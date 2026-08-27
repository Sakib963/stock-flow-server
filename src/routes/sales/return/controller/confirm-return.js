const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { restockStock, incrementProductStat } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { RETURNABLE_ORDER_STATUS } = require("../../../../utils/return-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Confirm a Pending return. This is the ONLY place a return moves stock, and it
// all happens in one transaction:
//
//   Good     -> restocked to the exact batch it was sold from
//   Damaged  -> written off through a pre-approved Product Disposal document
//
// plus returned_qty on the order lines, the product stat counters, and the order
// moving to PartiallyReturned or Returned.
//
// The lines are re-validated here even though create-return already checked them:
// another return on the same order may have been confirmed in between.
const confirm_return = async (request, res) => {
    const user_id = request.credentials.user_id;
    const return_oid = request.body.oid;

    try {
        const outcome = await execute_transaction(async (tx) => {
            const returnRows = await tx.get_data({
                text: `SELECT oid, order_oid, invoice_no AS return_no, CAST(refund_amount AS INTEGER) AS refund_amount, status
                         FROM ${TABLE.PRODUCT_RETURN} WHERE oid = $1 FOR UPDATE`,
                values: [return_oid],
            });
            if (!returnRows.length) fail(404, "Return not found");
            const ret = returnRows[0];
            if (ret.status !== "Pending") fail(409, `Only a Pending return can be confirmed (this one is ${ret.status})`);

            const order_oid = ret.order_oid;
            const orderRows = await tx.get_data({
                text: `SELECT invoice_no, status FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [order_oid],
            });
            if (!orderRows.length) fail(404, "Order not found");
            const order = orderRows[0];
            if (!RETURNABLE_ORDER_STATUS.includes(order.status)) {
                fail(409, `Order ${order.invoice_no} is ${order.status} and can no longer take a return`);
            }

            // Return lines joined to the order lines they came from, so the guard
            // below reads live returned_qty rather than anything cached at creation.
            const lines = await tx.get_data({
                text: `SELECT rd.oid, rd.order_item_oid, rd.product_oid, rd.inventory_oid, rd.condition,
                              CAST(rd.return_quantity AS INTEGER) AS return_quantity,
                              oi.product_name,
                              CAST(oi.quantity AS INTEGER) AS sold_quantity,
                              CAST(oi.returned_qty AS INTEGER) AS returned_qty
                         FROM ${TABLE.RETURN_DETAILS} rd
                         JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
                        WHERE rd.return_oid = $1`,
                values: [return_oid],
            });
            if (!lines.length) fail(409, "This return has no lines to confirm");

            for (const l of lines) {
                const remaining = l.sold_quantity - l.returned_qty;
                if (l.return_quantity > remaining) {
                    fail(409, `"${l.product_name}" only has ${Math.max(0, remaining)} unit(s) left to return. Another return was confirmed first, so this one must be cancelled and raised again`);
                }
            }

            // Damaged units become ONE disposal document per return, created
            // already Approved: the stock physically left inventory when the order
            // was fulfilled, so there is nothing further to deduct. This records
            // the write-off and feeds damaged analytics.
            const damaged = lines.filter((l) => l.condition === "Damaged");
            let dispose_oid = null;
            if (damaged.length) {
                const invRows = await tx.get_data({
                    text: `SELECT oid, CAST(cost_price AS INTEGER) AS cost_price FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
                    values: [[...new Set(damaged.map((d) => d.inventory_oid))]],
                });
                const costByInv = new Map(invRows.map((r) => [r.oid, r.cost_price]));
                const total_qty = damaged.reduce((s, d) => s + d.return_quantity, 0);
                const total_value = damaged.reduce((s, d) => s + d.return_quantity * (costByInv.get(d.inventory_oid) || 0), 0);

                dispose_oid = uuidv4();
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE}
                               (oid, dispose_no, disposal_date, disposal_method, total_dispose_quantity, total_dispose_value, notes, status, approved_by, approved_on, created_by)
                           VALUES ($1, $2, CURRENT_DATE, 'destroy', $3, $4, $5, 'Approved', $6, clock_timestamp(), $6)`,
                    values: [dispose_oid, `DISP-${ret.return_no}`, total_qty, total_value, `Damaged customer return ${ret.return_no} on order ${order.invoice_no}`, user_id],
                });

                for (const d of damaged) {
                    await tx.execute_value({
                        text: `INSERT INTO ${TABLE.DISPOSE_DETAILS}
                                   (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by)
                               VALUES ($1, $2, $3, $4, $5, 'damaged', $6, $7, $8)`,
                        values: [uuidv4(), dispose_oid, d.product_oid, d.inventory_oid, d.return_quantity, costByInv.get(d.inventory_oid) || 0, `Return ${ret.return_no}`, user_id],
                    });
                }
            }

            let restocked_units = 0;
            let disposed_units = 0;

            for (const l of lines) {
                const is_good = l.condition === "Good";

                await tx.execute_value({
                    text: `UPDATE ${TABLE.RETURN_DETAILS} SET action = $1, dispose_oid = $2 WHERE oid = $3`,
                    values: [is_good ? "Restocked" : "Disposed", is_good ? null : dispose_oid, l.oid],
                });
                await tx.execute_value({
                    text: `UPDATE ${TABLE.ORDER_ITEMS} SET returned_qty = returned_qty + $1 WHERE oid = $2`,
                    values: [l.return_quantity, l.order_item_oid],
                });

                if (is_good) {
                    await restockStock(tx, { inventory_oid: l.inventory_oid, quantity: l.return_quantity, user_id });
                    await incrementProductStat(tx, { product_oid: l.product_oid, column: "total_returned", quantity: l.return_quantity, user_id });
                    restocked_units += l.return_quantity;
                } else {
                    await incrementProductStat(tx, { product_oid: l.product_oid, column: "total_damaged", quantity: l.return_quantity, user_id });
                    disposed_units += l.return_quantity;
                }
            }

            await tx.execute_value({
                text: `UPDATE ${TABLE.PRODUCT_RETURN}
                          SET status = 'Returned', edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2`,
                values: [user_id, return_oid],
            });

            // Fully returned iff no line has any quantity left outstanding.
            const remainingRows = await tx.get_data({
                text: `SELECT COALESCE(SUM(quantity - returned_qty), 0)::int AS remaining FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`,
                values: [order_oid],
            });
            const new_status = remainingRows[0].remaining === 0 ? "Returned" : "PartiallyReturned";

            await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET status = $1, tracking_token = COALESCE(tracking_token, $4), edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3`,
                values: [new_status, user_id, order_oid, crypto.randomBytes(16).toString("hex")],
            });
            await recordStatusHistory(tx, {
                order_oid,
                from_status: order.status,
                to_status: new_status,
                reason: `Return ${ret.return_no} confirmed (refund intent ${ret.refund_amount})`,
                user_id,
            });

            return { order_oid, return_no: ret.return_no, refund_amount: ret.refund_amount, order_status: new_status, dispose_oid, restocked_units, disposed_units };
        });

        const disposal_note = outcome.disposed_units ? `, ${outcome.disposed_units} damaged unit(s) disposed` : "";
        saveLogActivity({
            reference_type: "order",
            reference_oid: outcome.order_oid,
            title: "Return Confirmed",
            description: `${outcome.return_no}: ${outcome.restocked_units} unit(s) restocked${disposal_note}. Order is now ${outcome.order_status}`,
            performed_by: user_id,
        });

        // Second entry under 'product-return'. The stock-movement analytics and the
        // activity-log filter both key off that reference_type, and confirmation is
        // the moment the stock actually moves, so this is where it belongs. The
        // entry above keeps the same event on the order's own timeline.
        saveLogActivity({
            reference_type: "product-return",
            reference_oid: return_oid,
            title: "Return Processed",
            description: `${outcome.return_no}: ${outcome.restocked_units} unit(s) restocked${disposal_note}`,
            performed_by: user_id,
        });

        log.info(`Return ${outcome.return_no} confirmed by ${user_id}; order now ${outcome.order_status}`);
        return res.status(200).json({
            code: 200,
            message: "Return confirmed",
            data: {
                return_no: outcome.return_no,
                order_status: outcome.order_status,
                dispose_oid: outcome.dispose_oid,
                restocked_units: outcome.restocked_units,
                disposed_units: outcome.disposed_units,
            },
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while confirming a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = confirm_return;
