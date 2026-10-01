const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

// What is on this aisle, the same rules as a warehouse (utils/warehouse-stats.js in warehouse/):
// stock is where its purchase order line was received, sellable is on hand less Active holds clamped at
// zero per batch and only on ready_for_sale batches, value is at cost, and low stock follows the product's threshold across every
// location. The item list is what a storekeeper checks the shelf against.
const STOCK_SQL = `
      WITH holds AS (
            SELECT inventory_oid, SUM(quantity)::int AS held
            FROM ${TABLE.STOCK_HOLD}
            WHERE status = 'Active'
            GROUP BY inventory_oid
      )
      SELECT i.product_oid, p.name, p.status, p.is_deleted, p.restock_threshold,
             i.quantity_available AS on_hand,
             CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) ELSE 0 END AS sellable,
             i.quantity_available * i.cost_price AS value
      FROM ${TABLE.INVENTORY} i
      JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
      LEFT JOIN holds h ON h.inventory_oid = i.oid
      WHERE i.aisle_oid = $1 AND i.quantity_available > 0
`;

// Sellable across every location, for the products on this aisle, to decide which are low.
const OVERALL_SQL = `
      WITH holds AS (
            SELECT inventory_oid, SUM(quantity)::int AS held
            FROM ${TABLE.STOCK_HOLD}
            WHERE status = 'Active'
            GROUP BY inventory_oid
      )
      SELECT i.product_oid, COALESCE(SUM(CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) ELSE 0 END), 0)::int AS sellable
      FROM ${TABLE.INVENTORY} i
      LEFT JOIN holds h ON h.inventory_oid = i.oid
      WHERE i.product_oid = ANY($1)
      GROUP BY i.product_oid
`;

/** The aisle record page's numbers and the products on it, by name. */
const read_aisle_stock = async (oid, capacity) => {
      const batches = await get_data({ text: STOCK_SQL, values: [oid] });
      const products = new Map();
      for (const b of batches) {
            const row = products.get(b.product_oid) ?? { product_oid: b.product_oid, name: b.name, onHand: 0, sellable: 0, threshold: Number(b.restock_threshold), countsLow: b.status === 'Active' && !b.is_deleted };
            row.onHand += Number(b.on_hand);
            row.sellable += Number(b.sellable);
            products.set(b.product_oid, row);
      }

      const overall = products.size ? await get_data({ text: OVERALL_SQL, values: [[...products.keys()]] }) : [];
      const overallOf = new Map(overall.map((r) => [r.product_oid, r.sellable]));
      const items = [...products.values()]
            .map((p) => ({ product_oid: p.product_oid, name: p.name, onHand: p.onHand, sellable: p.sellable, low: p.countsLow && p.threshold > 0 && (overallOf.get(p.product_oid) ?? 0) <= p.threshold }))
            .sort((a, b) => a.name.localeCompare(b.name));

      const onHand = items.reduce((sum, i) => sum + i.onHand, 0);
      return {
            stats: {
                  products: items.length,
                  onHand,
                  sellable: items.reduce((sum, i) => sum + i.sellable, 0),
                  value: batches.reduce((sum, b) => sum + Number(b.value), 0),
                  lowStock: items.filter((i) => i.low).length,
                  fullRate: capacity ? Math.round((onHand / capacity) * 1000) / 10 : null,
            },
            items,
      };
};

module.exports = { read_aisle_stock };
