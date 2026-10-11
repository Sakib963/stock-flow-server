const { TABLE } = require("../../../utils/constant");
const { saveLogActivity } = require("../../../utils/activity-logger");
const { restockStock, incrementProductStat } = require("./stock-movement");

// A gift added to an online order travels with the parcel (giveaway REQ-03): its holds are released,
// deducted and restocked by the order's own steps, and these move the giveaway's status alongside.

const linesOf = (tx, gifts) =>
    tx.get_data({
        text: `SELECT giveaway_oid, inventory_oid, product_oid, quantity FROM ${TABLE.GIVEAWAY_LINE} WHERE giveaway_oid = ANY($1) ORDER BY inventory_oid`,
        values: [gifts.map((gift) => gift.oid)],
    });

const logEach = async (gifts, title, description, { tx, request }) => {
    for (const gift of gifts) await saveLogActivity({ reference_type: "giveaway", reference_oid: gift.oid, title, description: `${gift.giveaway_no} ${description}` }, { tx, request });
};

// Dispatch: the order's held gift units were just deducted with given_away movements. Only a gift whose
// units were actually deducted is marked Given, so a gift whose hold was released never claims stock left.
const sendOrderGifts = async (tx, { order_oid, invoice_no, user_id, request }) => {
    const { rows } = await tx.execute_value({
        text: `UPDATE ${TABLE.GIVEAWAY} g SET status = 'Given', given_by = $1, given_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                WHERE g.order_oid = $2 AND g.status = 'Held'
                  AND EXISTS (SELECT 1 FROM ${TABLE.STOCK_HOLD} h JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.oid = h.giveaway_line_oid WHERE gl.giveaway_oid = g.oid AND h.status = 'Deducted')
            RETURNING g.oid, g.giveaway_no`,
        values: [user_id, order_oid],
    });
    for (const line of rows.length ? await linesOf(tx, rows) : []) await incrementProductStat(tx, { product_oid: line.product_oid, column: "total_given_away", quantity: line.quantity, user_id });
    await logEach(rows, "Giveaway given", `left with ${invoice_no}`, { tx, request });
};

// Cancel before dispatch: the order's holds, the gift's among them, were just released.
const dropOrderGifts = async (tx, { order_oid, invoice_no, user_id, request }) => {
    const { rows } = await tx.execute_value({
        text: `UPDATE ${TABLE.GIVEAWAY} SET status = 'Cancelled', cancel_reason = $3, edited_by = $1, edited_on = clock_timestamp()
                WHERE order_oid = $2 AND status = 'Held' RETURNING oid, giveaway_no`,
        values: [user_id, order_oid, `${invoice_no} cancelled`],
    });
    await logEach(rows, "Giveaway cancelled", `cancelled with ${invoice_no}`, { tx, request });
};

// A refused parcel back in the shop: each gift line goes back to the batch it came from, and was never given.
const returnOrderGifts = async (tx, { order_oid, invoice_no, user_id, request }) => {
    const { rows } = await tx.execute_value({
        text: `UPDATE ${TABLE.GIVEAWAY} SET status = 'Returned', edited_by = $1, edited_on = clock_timestamp()
                WHERE order_oid = $2 AND status = 'Given' RETURNING oid, giveaway_no`,
        values: [user_id, order_oid],
    });
    if (!rows.length) return;
    for (const line of await linesOf(tx, rows)) {
        await restockStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, reason: "returned", source_oid: line.giveaway_oid, user_id });
        await incrementProductStat(tx, { product_oid: line.product_oid, column: "total_given_away", quantity: -line.quantity, user_id });
    }
    await logEach(rows, "Giveaway returned", `back in stock with ${invoice_no}`, { tx, request });
};

module.exports = { sendOrderGifts, dropOrderGifts, returnOrderGifts };
