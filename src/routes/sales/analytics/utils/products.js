const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD, json_row, json_rows } = require("./sql");
const { PLACED_IN_PERIOD } = require("./order-flow");

// Products and suppliers (sales analytics REQ-100, 101, 154 to 157): what sold and what was kept,
// against what was wanted; who bought; what sells together; why goods come back; and whose goods
// they were. Sales follow the overview: lines of orders sold in the period, kept units at the line
// formula, cost from the line's own batch.
//
// $1 first day, $2 last day, $3 channels, $4 source, $5 category.

const SOLD = `
    sold AS (
        SELECT o.oid AS order_oid, o.customer_oid, oi.oid AS item_oid, p.oid AS product_oid, p.name AS product_name,
               oi.quantity, oi.returned_qty, (oi.unit_price - COALESCE(oi.discount, 0)) AS price, i.cost_price, i.purchase_details_oid
          FROM ${TABLE.ORDERS} o
          JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
          JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
          LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
          LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.sold_on IS NOT NULL AND ${IN_PERIOD("o.sold_on")}
           AND o.channel = ANY($3)
           AND ($4::text IS NULL OR oo.source_oid = $4)
           AND ($5::text IS NULL OR p.category_oid = $5)
    )`;

// Units on confirmed returns of those sales, with whether they came back damaged.
const RETURNED = `
    returned AS (
        SELECT sold.product_oid, sold.purchase_details_oid, pr.return_reason AS reason, rd.return_quantity AS units, rd.condition = 'Damaged' AS damaged
          FROM ${TABLE.RETURN_DETAILS} rd
          JOIN ${TABLE.PRODUCT_RETURN} pr ON pr.oid = rd.return_oid AND pr.status = 'Returned'
          JOIN sold ON sold.item_oid = rd.order_item_oid
    )`;

// Demand is every unit asked for, whatever happened next: counter sales when sold, online orders when placed.
const DEMAND = `
    demand AS (
        SELECT product_oid, SUM(quantity)::int AS units FROM (
            SELECT oi.product_oid, oi.quantity
              FROM ${TABLE.ORDERS} o JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
             WHERE o.channel = 'POS' AND 'POS' = ANY($3) AND $4::text IS NULL AND o.sold_on IS NOT NULL AND ${IN_PERIOD("o.sold_on")}
            UNION ALL
            SELECT oi.product_oid, oi.quantity
              FROM placed_on
              JOIN ${TABLE.ORDERS} o ON o.oid = placed_on.order_oid
              JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
              JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
             WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND o.status <> 'Draft' AND ($4::text IS NULL OR oo.source_oid = $4)
        ) asked
         WHERE $5::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.oid = asked.product_oid AND p.category_oid = $5)
         GROUP BY product_oid
    )`;

const PRODUCTS = `
    SELECT s.product_oid AS oid, s.product_name AS name,
           SUM(s.quantity - s.returned_qty)::int AS kept_units,
           COALESCE(MAX(d.units), 0)::int AS demand_units,
           SUM(s.price * (s.quantity - s.returned_qty))::float AS sales,
           SUM((s.price - COALESCE(s.cost_price, 0)) * (s.quantity - s.returned_qty))::float AS profit,
           SUM(s.quantity)::int AS sold_units,
           SUM(s.returned_qty)::int AS returned_units,
           COALESCE((SELECT SUM(r.units) FROM returned r WHERE r.product_oid = s.product_oid AND r.damaged), 0)::int AS damaged_units
      FROM sold s LEFT JOIN demand d ON d.product_oid = s.product_oid
     GROUP BY s.product_oid, s.product_name
     ORDER BY SUM(s.price * (s.quantity - s.returned_qty)) DESC, s.product_name
     LIMIT 10`;

// Two products the customer kept from the same sale, counted once per order.
const TOGETHER = `
    SELECT a.product_oid AS first_oid, a.product_name AS first_name, b.product_oid AS second_oid, b.product_name AS second_name, COUNT(DISTINCT a.order_oid)::int AS orders
      FROM sold a JOIN sold b ON b.order_oid = a.order_oid AND b.product_oid > a.product_oid
     WHERE a.quantity > a.returned_qty AND b.quantity > b.returned_qty
     GROUP BY a.product_oid, a.product_name, b.product_oid, b.product_name
    HAVING COUNT(DISTINCT a.order_oid) >= 2
     ORDER BY 5 DESC, 2, 4
     LIMIT 8`;

const RETURN_REASONS = `
    SELECT reason, SUM(units)::int AS units, COALESCE(SUM(units) FILTER (WHERE damaged), 0)::int AS damaged
      FROM returned GROUP BY reason ORDER BY 2 DESC, 1`;

// Each customer who kept something counted once, by what was recorded on them; a sale with no customer has none.
const BUYERS = `
    SELECT c.gender, c.age_band, COUNT(DISTINCT c.oid)::int AS customers
      FROM (SELECT DISTINCT customer_oid FROM sold WHERE customer_oid IS NOT NULL AND quantity > returned_qty) b
      JOIN ${TABLE.CUSTOMERS} c ON c.oid = b.customer_oid
     GROUP BY c.gender, c.age_band`;

// A batch traces to its supplier through its purchase order line; a batch from a stock adjustment
// has none. Sell-through is all time, for the supplier's batches: received against kept sales of them.
const SUPPLIERS = `
    SELECT su.oid, su.name,
           SUM(s.quantity - s.returned_qty)::int AS kept_units,
           SUM(s.price * (s.quantity - s.returned_qty))::float AS sales,
           SUM((s.price - COALESCE(s.cost_price, 0)) * (s.quantity - s.returned_qty))::float AS profit,
           SUM(s.quantity)::int AS sold_units,
           SUM(s.returned_qty)::int AS returned_units,
           COALESCE((SELECT SUM(r.units) FROM returned r
                       LEFT JOIN ${TABLE.PURCHASE_DETAILS} rpd ON rpd.oid = r.purchase_details_oid
                       LEFT JOIN ${TABLE.PURCHASE} rpu ON rpu.oid = rpd.purchase_oid
                      WHERE r.damaged AND rpu.supplier_oid IS NOT DISTINCT FROM su.oid), 0)::int AS damaged_units,
           (SELECT COALESCE(SUM(bi.initial_quantity), 0) FROM ${TABLE.INVENTORY} bi
              JOIN ${TABLE.PURCHASE_DETAILS} bpd ON bpd.oid = bi.purchase_details_oid
              JOIN ${TABLE.PURCHASE} bpu ON bpu.oid = bpd.purchase_oid
             WHERE bpu.supplier_oid = su.oid)::int AS received_all_time,
           (SELECT COALESCE(SUM(soi.quantity - soi.returned_qty), 0) FROM ${TABLE.ORDER_ITEMS} soi
              JOIN ${TABLE.ORDERS} so ON so.oid = soi.order_oid AND so.sold_on IS NOT NULL
              JOIN ${TABLE.INVENTORY} si ON si.oid = soi.inventory_oid
              JOIN ${TABLE.PURCHASE_DETAILS} spd ON spd.oid = si.purchase_details_oid
              JOIN ${TABLE.PURCHASE} spu ON spu.oid = spd.purchase_oid
             WHERE spu.supplier_oid = su.oid)::int AS kept_all_time
      FROM sold s
      LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = s.purchase_details_oid
      LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid
      LEFT JOIN ${TABLE.SUPPLIER} su ON su.oid = pu.supplier_oid
     GROUP BY su.oid, su.name
     ORDER BY SUM(s.price * (s.quantity - s.returned_qty)) DESC, su.name`;

// What each age band kept most of: the top three products by kept units among buyers with that band recorded.
const AGE_DEMAND = `
    SELECT age_band, product_oid AS oid, product_name AS name, units, buyers FROM (
        SELECT c.age_band, s.product_oid, s.product_name, SUM(s.quantity - s.returned_qty)::int AS units, COUNT(DISTINCT c.oid)::int AS buyers,
               ROW_NUMBER() OVER (PARTITION BY c.age_band ORDER BY SUM(s.quantity - s.returned_qty) DESC, s.product_name) AS rank
          FROM sold s JOIN ${TABLE.CUSTOMERS} c ON c.oid = s.customer_oid
         WHERE c.age_band IS NOT NULL AND s.quantity > s.returned_qty
         GROUP BY c.age_band, s.product_oid, s.product_name) ranked
     WHERE rank <= 3
     ORDER BY age_band, rank`;

const PRODUCTS_SQL = `
    WITH ${SOLD}, ${RETURNED}, ${PLACED_IN_PERIOD}, ${DEMAND}
    SELECT ${json_rows(PRODUCTS)} AS products,
           ${json_rows(TOGETHER)} AS together,
           ${json_rows(RETURN_REASONS)} AS return_reasons,
           ${json_rows(BUYERS)} AS buyers,
           ${json_rows(AGE_DEMAND)} AS age_demand,
           ${json_rows(SUPPLIERS)} AS suppliers,
           ${json_row("SELECT COALESCE(SUM(price * (quantity - returned_qty)), 0)::float AS sales, COUNT(DISTINCT order_oid) FILTER (WHERE quantity > returned_qty)::int AS orders, COUNT(DISTINCT order_oid) FILTER (WHERE customer_oid IS NULL AND quantity > returned_qty)::int AS without_customer FROM sold")} AS totals`;

const read_products = async (from, to, { channels, source_oid, category_oid }) => (await get_data({ text: PRODUCTS_SQL, values: [from, to, channels, source_oid, category_oid] }))[0];

module.exports = { read_products };
