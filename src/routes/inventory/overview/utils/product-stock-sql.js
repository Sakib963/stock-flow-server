const { TABLE } = require("../../../../utils/constant");
const { BATCH_FIGURES, PRODUCT_FIGURES } = require("./stock-figures");

// Read by the product stock page and its report, so the file always says what the page says.
const PRODUCT_SQL = `
      SELECT p.oid, p.name, p.sku, p.photo, p.status, p.unit_type, p.restock_threshold::int AS restock_threshold, p.has_expiry,
             p.category_oid, c.name AS category_name, p.sub_category_oid, s.name AS sub_category_name, p.brand_oid, br.name AS brand_name
        FROM ${TABLE.PRODUCT} p
        LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
        LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
        LEFT JOIN ${TABLE.BRANDS} br ON br.oid = p.brand_oid
       WHERE p.oid = $1 AND p.is_deleted = FALSE`;

const FIGURES_SQL = `SELECT ${PRODUCT_FIGURES} FROM (${BATCH_FIGURES}) b WHERE b.product_oid = $1`;

// Every batch, sold out ones included (the page hides them until asked), oldest first: the order
// stock leaves in. Where it came from and where it sits are the purchase line's.
const BATCHES_SQL = `
      SELECT b.*, (b.selling_price - b.cost_price - b.budget_per_unit)::bigint AS margin_per_unit,
             (b.on_hand * b.cost_price)::float8 AS stock_value,
             (CASE WHEN b.priced THEN b.on_hand * b.selling_price END)::float8 AS expected_revenue,
             (CASE WHEN b.priced THEN b.on_hand * (b.selling_price - b.cost_price - b.budget_per_unit) END)::float8 AS profit_full,
             w.name AS warehouse_name, a.name AS aisle_name, pu.oid AS purchase_oid, pu.po_number, su.name AS supplier_name
        FROM (${BATCH_FIGURES}) b
        LEFT JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = b.purchase_details_oid
        LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = d.purchase_oid
        LEFT JOIN ${TABLE.SUPPLIER} su ON su.oid = pu.supplier_oid
        LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = b.warehouse_oid
        LEFT JOIN ${TABLE.AISLE} a ON a.oid = b.aisle_oid
       WHERE b.product_oid = $1
       ORDER BY b.received_on ASC, b.oid ASC`;

module.exports = { PRODUCT_SQL, FIGURES_SQL, BATCHES_SQL };
