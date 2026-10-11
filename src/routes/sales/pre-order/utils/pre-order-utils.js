const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

const recordPreOrderStatusHistory = async (tx, { pre_order_oid, from_status, to_status, reason = null, user_id }) => {
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.PRE_ORDER_STATUS_HISTORY} (oid, pre_order_oid, from_status, to_status, reason, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        values: [uuidv4(), pre_order_oid, from_status, to_status, reason, user_id],
    });
};

// Per product, what can be sold now: on hand less Active holds, over the batches an order can take (cart.js).
const SELLABLE_BY_PRODUCT_CTE = `
    SELECT i.product_oid, SUM(i.quantity_available - COALESCE(h.held, 0))::int AS sellable
      FROM ${TABLE.INVENTORY} i
      LEFT JOIN (SELECT inventory_oid, SUM(quantity)::int AS held FROM ${TABLE.STOCK_HOLD} WHERE status = 'Active' GROUP BY inventory_oid) h ON h.inventory_oid = i.oid
     WHERE i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
     GROUP BY i.product_oid`;

// Replaces a booking's lines. The product's name comes from the catalogue, and the total from the line
// formula with no discount: the price is approximate until the batch is chosen at conversion.
const writeLines = async (tx, pre_order_oid, lines) => {
    const products = await tx.get_data({
        text: `SELECT oid, name FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND COALESCE(is_deleted, false) = false`,
        values: [lines.map((line) => line.product_oid)],
    });
    if (products.length !== lines.length) fail(409, "A product on this booking was deleted from the catalogue. Remove it and pick again.");
    const name_of = new Map(products.map((product) => [product.oid, product.name]));
    await tx.execute_value({ text: `DELETE FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1`, values: [pre_order_oid] });
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.PRE_ORDER_ITEMS} (oid, pre_order_oid, product_oid, product_name, quantity, unit_price, discount, total)
               SELECT *, 0, q * p FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::int[], $6::int[]) AS l(oid, po, product, name, q, p)`,
        values: [lines.map(() => uuidv4()), lines.map(() => pre_order_oid), lines.map((line) => line.product_oid), lines.map((line) => name_of.get(line.product_oid)), lines.map((line) => line.quantity), lines.map((line) => line.unit_price)],
    });
    return lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
};

const OPEN_STATUSES = ["Pending", "Confirmed"];

// What a product really goes for, to guide the approximate price: the median of what customers paid
// per unit (after the per-unit discount) on sales in the last 180 days, the last such price, what
// batches with stock are priced at now, and the last buying cost. Cost is money: the caller drops it
// for someone without inventory.stock-value.view. `product` is the alias of the product column.
const priceHints = (product) => ({
    select: `ph.usual_price, ph.sales, ph.last_price, pn.price_from, pn.price_to, pc.last_cost`,
    joins: `
        LEFT JOIN LATERAL (
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY oi.unit_price - COALESCE(oi.discount, 0))::int AS usual_price, COUNT(*)::int AS sales,
                   (array_agg((oi.unit_price - COALESCE(oi.discount, 0))::int ORDER BY o.sold_on DESC))[1] AS last_price
              FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid
             WHERE oi.product_oid = ${product} AND o.status IN ('Purchased', 'Delivered', 'PartiallyReturned') AND o.sold_on >= NOW() - INTERVAL '180 days') ph ON true
        LEFT JOIN LATERAL (
            SELECT MIN(i.selling_price)::int AS price_from, MAX(i.selling_price)::int AS price_to
              FROM ${TABLE.INVENTORY} i
             WHERE i.product_oid = ${product} AND i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL AND i.quantity_available > 0) pn ON true
        LEFT JOIN LATERAL (
            SELECT i.cost_price::int AS last_cost FROM ${TABLE.INVENTORY} i WHERE i.product_oid = ${product} AND i.cost_price IS NOT NULL ORDER BY i.created_on DESC LIMIT 1) pc ON true`,
});

module.exports = { recordPreOrderStatusHistory, SELLABLE_BY_PRODUCT_CTE, writeLines, OPEN_STATUSES, priceHints };
