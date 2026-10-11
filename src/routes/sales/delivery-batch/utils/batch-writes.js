const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { READY, IN_A_BATCH } = require("./batch-orders");

/**
 * Puts orders in a batch, each still ready to send and in no other batch, or refuses naming the ones
 * that are not. The orders are locked, so one cannot be dispatched on its own record meanwhile; two
 * batches taking one order at the same moment are stopped by the partial unique index (REQ-03).
 */
const addOrders = async (tx, { batch_oid, order_oids, user_id }) => {
    if (!order_oids.length) return;
    const ok = await tx.get_data({
        text: `SELECT o.oid FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                WHERE o.oid = ANY($1) AND ${READY} AND NOT ${IN_A_BATCH} FOR UPDATE OF o`,
        values: [order_oids],
    });
    if (ok.length !== order_oids.length) {
        const fine = new Set(ok.map((row) => row.oid));
        const refused = await tx.get_data({ text: `SELECT invoice_no FROM ${TABLE.ORDERS} WHERE oid = ANY($1) ORDER BY invoice_no`, values: [order_oids.filter((oid) => !fine.has(oid))] });
        const names = refused.map((row) => row.invoice_no).join(", ") || "an order that no longer exists";
        fail(409, `Not ready to send any more, or already in another batch: ${names}. Reload the orders and try again.`, { invoices: refused.map((row) => row.invoice_no) });
    }
    for (const order_oid of order_oids) {
        await tx.execute_value({ text: `INSERT INTO ${TABLE.DELIVERY_BATCH_ORDER} (oid, batch_oid, order_oid, created_by) VALUES ($1, $2, $3, $4)`, values: [uuidv4(), batch_oid, order_oid, user_id] });
    }
};

// Two saves taking one order at once: the second insert breaks the one-open-batch index.
const takenElsewhere = (e) => e?.code === "23505" && /delivery_batch_order_one_open/.test(e?.constraint ?? e?.message ?? "");

module.exports = { addOrders, takenElsewhere };
