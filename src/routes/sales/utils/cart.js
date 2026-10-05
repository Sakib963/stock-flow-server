const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../utils/constant");
const { fail } = require("../../../db/database");

const batch_name = (b) => `${b.product_name}, ${b.batch_code}`;

// Prices every line from its batch: the unit price is the batch's selling price and the per unit
// discount may not pass its maximum discount (sales REQ-17), so a sale never goes below what the
// profit figures assume. Whatever price the client showed is never read.
const price_lines = async (tx, lines) => {
    const batches = await tx.get_data({
        text: `SELECT i.oid, i.batch_code, i.selling_price::int AS selling_price, COALESCE(i.maximum_discount, 0)::int AS maximum_discount,
                      i.intended_use, i.status, p.oid AS product_oid, p.name AS product_name, p.is_deleted
                 FROM ${TABLE.INVENTORY} i
                 JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                WHERE i.oid = ANY($1)`,
        values: [lines.map((l) => l.inventory_oid)],
    });
    const by_oid = new Map(batches.map((b) => [b.oid, b]));

    return lines.map((line) => {
        const b = by_oid.get(line.inventory_oid);
        if (!b) fail(400, "A line in the cart is no longer in stock. Remove it and search for the product again.", { inventory_oid: line.inventory_oid });
        if (b.is_deleted || b.intended_use !== "for_sale" || b.status !== "ready_for_sale" || b.selling_price === null) {
            fail(400, `${batch_name(b)} is not for sale any more. Remove it from the cart.`, { inventory_oid: b.oid });
        }
        const allowed = Math.min(b.maximum_discount, b.selling_price);
        if (line.discount > allowed) fail(400, `The discount on ${batch_name(b)} can be at most ${allowed} a unit.`, { inventory_oid: b.oid, maximum_discount: allowed });

        return {
            oid: uuidv4(),
            inventory_oid: b.oid,
            product_oid: b.product_oid,
            product_name: b.product_name,
            batch_code: b.batch_code,
            quantity: line.quantity,
            unit_price: b.selling_price,
            discount: line.discount,
            total: (b.selling_price - line.discount) * line.quantity,
        };
    });
};

const cart_totals = (priced) => {
    const subtotal = priced.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
    const discount_total = priced.reduce((sum, l) => sum + l.discount * l.quantity, 0);
    return { subtotal, discount_total, total_amount: subtotal - discount_total };
};

const insert_lines = async (tx, order_oid, priced) => {
    for (const l of priced) {
        await tx.execute_value({
            text: `INSERT INTO ${TABLE.ORDER_ITEMS} (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)`,
            values: [l.oid, order_oid, l.inventory_oid, l.product_oid, l.product_name, l.quantity, l.unit_price, l.discount, l.total],
        });
    }
};

module.exports = { price_lines, cart_totals, insert_lines, batch_name };
