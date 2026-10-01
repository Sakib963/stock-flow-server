// -----------------------------------------------------------------------------
// Batch-level stock movement helpers.
//
// Physical on-hand of a batch = inventory.quantity_available (unchanged meaning).
// Sellable of a batch        = quantity_available - SUM(Active holds on it).
//
// Every helper takes the `tx` handle from `execute_transaction` (utils/database)
// so it composes inside ONE transaction with the order-state change -- stock and
// order state never diverge. Guards are enforced in SQL (WHERE ... >= qty) and
// verified via rowCount so two concurrent orders can never both take the last unit.
// -----------------------------------------------------------------------------
const { TABLE } = require("../../../utils/constant");
const { fail } = require("../../../db/database");
const { v4: uuidv4 } = require("uuid");

// Every change to a batch's quantity writes one row, in the same transaction and after the guarded
// update, so the batch row is still locked and balance_after is exactly what it now holds. The rows of
// a batch therefore always add up to its quantity. Only these helpers call it.
const recordMovement = async (tx, { inventory_oid, quantity, reason, source_oid, user_id }) => {
    const [batch] = await tx.get_data({
        text: `SELECT product_oid, quantity_available::int AS balance FROM ${TABLE.INVENTORY} WHERE oid = $1`,
        values: [inventory_oid],
    });
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.STOCK_MOVEMENT} (oid, inventory_oid, product_oid, quantity, balance_after, reason, source_oid, created_by, created_on)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())`,
        values: [uuidv4(), inventory_oid, batch.product_oid, quantity, batch.balance, reason, source_oid, user_id],
    });
};

// A new batch received from a purchase order. It is inserted with its full quantity, so the movement
// is that quantity.
const receiveStock = (tx, { inventory_oid, quantity, purchase_oid, user_id }) => recordMovement(tx, { inventory_oid, quantity, reason: "received", source_oid: purchase_oid, user_id });

// A new batch a stock adjustment created, inserted with its full quantity, like a received one.
const openBatch = (tx, { inventory_oid, quantity, reason, source_oid, user_id }) => recordMovement(tx, { inventory_oid, quantity, reason, source_oid, user_id });

// Take physical stock off a batch, guarded so it never goes below zero. Returns false when the batch
// holds less than asked, and then nothing is written.
const deductStock = async (tx, { inventory_oid, quantity, reason, source_oid, user_id }) => {
    const deducted = await tx.execute_value({
        text: `UPDATE ${TABLE.INVENTORY}
                  SET quantity_available = quantity_available - $1, edited_by = $2, edited_on = clock_timestamp()
                WHERE oid = $3 AND quantity_available >= $1`,
        values: [quantity, user_id, inventory_oid],
    });
    if (deducted.rowCount !== 1) return false;
    await recordMovement(tx, { inventory_oid, quantity: -quantity, reason, source_oid, user_id });
    return true;
};

// Sum of Active holds per batch, for a set of inventory oids. Returns Map<oid, qty>.
const getActiveHolds = async (tx, inventory_oids) => {
    if (!inventory_oids.length) return new Map();
    const rows = await tx.get_data({
        text: `SELECT inventory_oid, COALESCE(SUM(quantity), 0)::int AS held
                 FROM ${TABLE.STOCK_HOLD}
                WHERE inventory_oid = ANY($1) AND status = 'Active'
                GROUP BY inventory_oid`,
        values: [inventory_oids],
    });
    return new Map(rows.map((r) => [r.inventory_oid, Number(r.held)]));
};

// Place an ACTIVE hold on a batch, atomically. Locks the batch row (FOR UPDATE)
// so two concurrent orders can't both hold the last unit, then checks sellable
// (on-hand minus existing Active holds). Physical quantity_available is unchanged.
// Returns { ok, sellable } -- ok=false means not enough sellable stock.
const holdStock = async (tx, { order_oid, order_item_oid = null, product_oid, inventory_oid, quantity, user_id }) => {
    const inv = await tx.get_data({
        text: `SELECT quantity_available::int AS qa FROM ${TABLE.INVENTORY} WHERE oid = $1 FOR UPDATE`,
        values: [inventory_oid],
    });
    if (!inv.length) return { ok: false, sellable: 0 };
    const held = await tx.get_data({
        text: `SELECT COALESCE(SUM(quantity), 0)::int AS h FROM ${TABLE.STOCK_HOLD} WHERE inventory_oid = $1 AND status = 'Active'`,
        values: [inventory_oid],
    });
    const sellable = inv[0].qa - held[0].h;
    if (sellable < quantity) return { ok: false, sellable };
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.STOCK_HOLD}
                   (oid, order_oid, order_item_oid, product_oid, inventory_oid, quantity, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7)`,
        values: [uuidv4(), order_oid, order_item_oid, product_oid, inventory_oid, quantity, user_id],
    });
    return { ok: true, sellable };
};

// Remove physical stock, but only what is free of Active holds: units promised to an online order
// are not anyone else's to take. Returns true on success, false if blocked.
const deductFreeStock = async (tx, { inventory_oid, quantity, reason, source_oid, user_id }) => {
    // The batch is locked in its own statement first. The guarded UPDATE then starts after any hold still
    // being written on it has committed, and counts it: taking its snapshot before the lock let a theft
    // and an order's hold both have the same last units.
    await tx.get_data({ text: `SELECT 1 FROM ${TABLE.INVENTORY} WHERE oid = $1 FOR UPDATE`, values: [inventory_oid] });
    const result = await tx.execute_value({
        text: `UPDATE ${TABLE.INVENTORY}
                  SET quantity_available = quantity_available - $1,
                      edited_by = $2, edited_on = clock_timestamp()
                WHERE oid = $3
                  AND quantity_available - COALESCE(
                        (SELECT SUM(quantity) FROM ${TABLE.STOCK_HOLD}
                          WHERE inventory_oid = $3 AND status = 'Active'), 0) >= $1`,
        values: [quantity, user_id, inventory_oid],
    });
    if (result.rowCount !== 1) return false;
    await recordMovement(tx, { inventory_oid, quantity: -quantity, reason, source_oid, user_id });
    return true;
};

// POS deduct: what is sold at the counter comes out of what is free of holds.
const deductSellableStock = (tx, { inventory_oid, quantity, order_oid, user_id }) => deductFreeStock(tx, { inventory_oid, quantity, reason: "sold", source_oid: order_oid, user_id });

// Release all Active holds of an order (cancellation before dispatch). Physical
// quantity_available never changed while held, so nothing to add back -- the units
// simply become sellable again. Returns count released.
const releaseHolds = async (tx, { order_oid, user_id }) => {
    const r = await tx.execute_value({
        text: `UPDATE ${TABLE.STOCK_HOLD}
                  SET status = 'Released', edited_by = $1, edited_on = clock_timestamp()
                WHERE order_oid = $2 AND status = 'Active'`,
        values: [user_id, order_oid],
    });
    return r.rowCount;
};

// Dispatch: convert this order's Active holds into a physical deduction. Deducts
// quantity_available for each held batch and marks the holds Deducted. Guarded on
// physical on-hand. Returns { ok }.
const deductHeldStock = async (tx, { order_oid, user_id }) => {
    const holds = await tx.get_data({
        text: `SELECT oid, inventory_oid, quantity FROM ${TABLE.STOCK_HOLD} WHERE order_oid = $1 AND status = 'Active'`,
        values: [order_oid],
    });
    for (const h of holds) {
        const deducted = await deductStock(tx, { inventory_oid: h.inventory_oid, quantity: h.quantity, reason: "dispatched", source_oid: order_oid, user_id });
        if (!deducted) return { ok: false };
        await tx.execute_value({
            text: `UPDATE ${TABLE.STOCK_HOLD} SET status = 'Deducted', edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2`,
            values: [user_id, h.oid],
        });
    }
    return { ok: true, count: holds.length };
};

// Restock: add physical stock back (good-condition returns, reversed disposals).
// Stock never goes back onto a deleted product: it would sit in the warehouse in no list anyone
// can see (decided by the user, 2026-09-27). The shared lock waits for a delete in flight, which
// holds the product row for update, and the delete in turn refuses a product with stock.
const refuseDeletedProduct = async (tx, inventory_oid) => {
    const [row] = await tx.get_data({
        text: `SELECT p.name, p.is_deleted FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid WHERE i.oid = $1 FOR SHARE OF p`,
        values: [inventory_oid],
    });
    if (row?.is_deleted) fail(409, `${row.name} has been deleted, so no stock can be put back on it. Restore the product first.`, { reason: "product_deleted" });
};

const restockStock = async (tx, { inventory_oid, quantity, reason, source_oid, user_id }) => {
    await refuseDeletedProduct(tx, inventory_oid);
    await tx.execute_value({
        text: `UPDATE ${TABLE.INVENTORY}
                  SET quantity_available = quantity_available + $1,
                      edited_by = $2, edited_on = clock_timestamp()
                WHERE oid = $3`,
        values: [quantity, user_id, inventory_oid],
    });
    await recordMovement(tx, { inventory_oid, quantity, reason, source_oid, user_id });
};

// Increment a product_stats counter, creating the row if the product has none yet.
const incrementProductStat = async (tx, { product_oid, column, quantity, user_id }) => {
    const allowed = new Set(["total_sold", "total_returned", "total_damaged", "total_wasted"]);
    if (!allowed.has(column)) throw new Error(`Invalid product_stats column: ${column}`);
    const updated = await tx.execute_value({
        text: `UPDATE ${TABLE.PRODUCT_STATS}
                  SET ${column} = ${column} + $1, last_edited_on = clock_timestamp()
                WHERE product_oid = $2`,
        values: [quantity, product_oid],
    });
    if (updated.rowCount === 0) {
        await tx.execute_value({
            text: `INSERT INTO ${TABLE.PRODUCT_STATS} (oid, product_oid, ${column}) VALUES ($1, $2, $3)`,
            values: [uuidv4(), product_oid, quantity],
        });
    }
};

module.exports = {
    receiveStock,
    openBatch,
    deductFreeStock,
    deductStock,
    refuseDeletedProduct,
    getActiveHolds,
    holdStock,
    releaseHolds,
    deductHeldStock,
    deductSellableStock,
    restockStock,
    incrementProductStat,
};
