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
const { TABLE } = require("./constant");
const { v4: uuidv4 } = require("uuid");

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

// POS deduct: remove physical stock, but only if SELLABLE (on-hand minus other
// Active holds) covers it. Returns true on success, false if blocked.
const deductSellableStock = async (tx, { inventory_oid, quantity, user_id }) => {
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
    return result.rowCount === 1;
};

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
        const deducted = await tx.execute_value({
            text: `UPDATE ${TABLE.INVENTORY}
                      SET quantity_available = quantity_available - $1, edited_by = $2, edited_on = clock_timestamp()
                    WHERE oid = $3 AND quantity_available >= $1`,
            values: [h.quantity, user_id, h.inventory_oid],
        });
        if (deducted.rowCount !== 1) return { ok: false };
        await tx.execute_value({
            text: `UPDATE ${TABLE.STOCK_HOLD} SET status = 'Deducted', edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2`,
            values: [user_id, h.oid],
        });
    }
    return { ok: true, count: holds.length };
};

// Restock: add physical stock back (good-condition returns / reversals).
const restockStock = async (tx, { inventory_oid, quantity, user_id }) => {
    await tx.execute_value({
        text: `UPDATE ${TABLE.INVENTORY}
                  SET quantity_available = quantity_available + $1,
                      edited_by = $2, edited_on = clock_timestamp()
                WHERE oid = $3`,
        values: [quantity, user_id, inventory_oid],
    });
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
    getActiveHolds,
    holdStock,
    releaseHolds,
    deductHeldStock,
    deductSellableStock,
    restockStock,
    incrementProductStat,
};
