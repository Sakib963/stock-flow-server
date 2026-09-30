const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { getSettings } = require("../../../../utils/settings-cache");
const { BATCH_FIGURES, PRODUCT_FIGURES, sees_money, without_money } = require("../utils/stock-figures");

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
        LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = d.warehouse_oid
        LEFT JOIN ${TABLE.AISLE} a ON a.oid = d.aisle_oid
       WHERE b.product_oid = $1
       ORDER BY b.received_on ASC, b.oid ASC`;

const get_product_stock = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[product], [figures], batches, activity, money, settings] = await Promise.all([
                  get_data({ text: PRODUCT_SQL, values: [oid] }),
                  get_data({ text: FIGURES_SQL, values: [oid] }),
                  get_data({ text: BATCHES_SQL, values: [oid] }),
                  getLogActivities("product-stock", oid, 10),
                  sees_money(request),
                  getSettings(),
            ]);
            if (!product) return res.status(404).json({ code: 404, message: "That product no longer exists. It may have been deleted." });

            const shown = batches.map(({ purchase_details_oid, ...batch }) => (money ? batch : without_money(batch)));
            return res.status(200).json({
                  code: 200,
                  message: "Product stock",
                  data: {
                        product,
                        figures: money ? figures : without_money(figures),
                        batches: shown,
                        // A budget change names a cost, so it is someone else's to read.
                        activity: activity.filter((a) => money || a.title !== "Budget changed").map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                        sees_money: money,
                        // Printed on every sticker.
                        business_name: settings?.name ?? null,
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while loading the stock of product ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load this product's stock. Try again in a moment." });
      }
};

module.exports = get_product_stock;
