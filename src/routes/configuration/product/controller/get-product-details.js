const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const DETAILS_SQL = `
      SELECT p.oid, p.name, p.sku, p.photo, p.unit_type, p.description, p.restock_threshold::int AS restock_threshold, p.status, p.has_expiry,
             p.category_oid, c.name AS category_name, p.sub_category_oid, s.name AS sub_category_name, p.brand_oid, b.name AS brand_name,
             p.created_by, p.created_on, p.edited_by, p.edited_on,
             COALESCE(p.edited_on, p.created_on) AS last_action_on,
             COALESCE(p.edited_by, p.created_by) AS last_action_by
      FROM ${TABLE.PRODUCT} p
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
      LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
      WHERE p.oid = $1 AND p.is_deleted = FALSE`;

// Every batch still holding or promising something, oldest first, which is the order stock leaves in.
const BATCHES_SQL = `
      SELECT i.oid, i.batch_code, w.name AS warehouse_name, i.created_on AS received_on,
             i.quantity_available::int AS on_hand, h.held,
             (CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - h.held, 0) ELSE 0 END)::int AS sellable,
             i.cost_price::int AS cost_price, i.selling_price::int AS selling_price, i.status,
             to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry_date
      FROM ${TABLE.INVENTORY} i
      LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
      LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
      CROSS JOIN LATERAL (SELECT COALESCE(SUM(quantity), 0)::int AS held FROM ${TABLE.STOCK_HOLD} WHERE inventory_oid = i.oid AND status = 'Active') h
      WHERE i.product_oid = $1 AND (i.quantity_available > 0 OR h.held > 0)
      ORDER BY i.created_on ASC, i.oid ASC`;

// Summed, not read as one row: two first sales at once can each insert a stats row (on the backlog),
// and each then carries its own sale. A sale is an order in a realized state only, dated by sold_on:
// a POS draft checked out days later was dated by the draft.
const LIFETIME_SQL = `
      SELECT (SELECT COALESCE(SUM(total_sold), 0)::int FROM ${TABLE.PRODUCT_STATS} WHERE product_oid = $1) AS sold,
             (SELECT COALESCE(SUM(total_returned), 0)::int FROM ${TABLE.PRODUCT_STATS} WHERE product_oid = $1) AS returned,
             (SELECT COALESCE(SUM(total_damaged), 0)::int FROM ${TABLE.PRODUCT_STATS} WHERE product_oid = $1) AS damaged,
             (SELECT MAX(o.sold_on)
                FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid
               WHERE oi.product_oid = $1 AND o.status IN ('Purchased', 'Delivered', 'PartiallyReturned')) AS last_sold_on`;

const get_product_details = async (request, res) => {
      try {
            const productOid = request.params.oid;

            const [details] = await get_data({ text: DETAILS_SQL, values: [productOid] });
            if (!details) {
                  log.warn(`Product not found for oid: ${productOid}`);
                  return res.status(404).json({ code: 404, message: "Product not found", data: null });
            }

            const [batches, [lifetime], activity_set] = await Promise.all([get_data({ text: BATCHES_SQL, values: [productOid] }), get_data({ text: LIFETIME_SQL, values: [productOid] }), getLogActivities("product", productOid, 5)]);

            const stock = batches.reduce((sum, batch) => ({ on_hand: sum.on_hand + batch.on_hand, held: sum.held + batch.held, sellable: sum.sellable + batch.sellable }), { on_hand: 0, held: 0, sellable: 0 });

            return res.status(200).json({
                  code: 200,
                  message: "Product details found successfully",
                  data: {
                        details,
                        stock: { ...stock, batches },
                        lifetime,
                        activity: activity_set.map((a) => ({
                              oid: a.oid,
                              date: a.performed_on,
                              user: a.performed_by,
                              action: a.title,
                              description: a.description,
                        })),
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while getting product details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_product_details;
