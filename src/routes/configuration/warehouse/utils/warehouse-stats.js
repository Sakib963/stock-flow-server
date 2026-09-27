const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

// What is in a warehouse, what it is worth, and what needs attention.
//
// A batch has no location column of its own: it is where its purchase order line was received,
// purchase_details.warehouse_oid and aisle_oid. Nothing moves stock between locations yet, so that is
// where it still is.
//
// Sellable is on hand less Active holds, clamped at zero per batch, the same as every other stock
// number. Value is at cost_price, what was spent on the stock physically there.
//
// Low stock is a product-level fact, not a location one: restock_threshold is per product. A product
// counts here when it has stock in this warehouse and its sellable total across every location is at
// or under its threshold, which is the list of things to reorder that someone standing in this
// warehouse can act on.
//
// Not in an aisle is stock received without an aisle: it is in the building but on no shelf anyone
// can be sent to.
const WAREHOUSE_STATS_SQL = `
      WITH holds AS (
            SELECT inventory_oid, SUM(quantity)::int AS held
            FROM ${TABLE.STOCK_HOLD}
            WHERE status = 'Active'
            GROUP BY inventory_oid
      ),
      batches AS (
            SELECT i.product_oid, d.aisle_oid, i.quantity_available AS on_hand,
                   GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) AS sellable,
                   i.quantity_available * i.cost_price AS value
            FROM ${TABLE.INVENTORY} i
            JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = i.purchase_details_oid
            LEFT JOIN holds h ON h.inventory_oid = i.oid
            WHERE d.warehouse_oid = $1
      ),
      product_totals AS (
            SELECT p.oid, p.restock_threshold, COALESCE(SUM(GREATEST(i.quantity_available - COALESCE(h.held, 0), 0)), 0) AS sellable
            FROM ${TABLE.PRODUCT} p
            JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
            LEFT JOIN holds h ON h.inventory_oid = i.oid
            WHERE p.is_deleted = FALSE AND p.status = 'Active' AND p.oid IN (SELECT product_oid FROM batches WHERE on_hand > 0)
            GROUP BY p.oid, p.restock_threshold
      )
      SELECT
            (SELECT COUNT(DISTINCT product_oid) FROM batches WHERE on_hand > 0)::int AS products,
            (SELECT COALESCE(SUM(on_hand), 0) FROM batches)::int AS on_hand,
            (SELECT COALESCE(SUM(sellable), 0) FROM batches)::int AS sellable,
            (SELECT COALESCE(SUM(value), 0) FROM batches) AS value,
            (SELECT COALESCE(SUM(on_hand), 0) FROM batches WHERE aisle_oid IS NULL)::int AS unplaced,
            (SELECT COUNT(*) FROM product_totals WHERE sellable <= restock_threshold AND restock_threshold > 0)::int AS low_stock,
            (SELECT COUNT(*) FROM ${TABLE.AISLE} WHERE warehouse_oid = $1 AND status = 'Active')::int AS zones,
            (SELECT capacity_units FROM ${TABLE.WAREHOUSE} WHERE oid = $1) AS capacity
`;

/** The warehouse record page's numbers. How full is null when no capacity was given. */
const read_warehouse_stats = async (oid) => {
      const [row] = await get_data({ text: WAREHOUSE_STATS_SQL, values: [oid] });
      return {
            products: row.products,
            onHand: row.on_hand,
            sellable: row.sellable,
            value: Number(row.value),
            unplaced: row.unplaced,
            lowStock: row.low_stock,
            zones: row.zones,
            fullRate: row.capacity ? Math.round((row.on_hand / row.capacity) * 1000) / 10 : null,
      };
};

module.exports = { read_warehouse_stats };
