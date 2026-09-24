const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const get_category_details = async (request, res) => {
      try {
            const categoryOid = request.params.oid;

            const detailsSql = generate_details_sql(categoryOid);
            const details_set = await get_data(detailsSql);
            const details = details_set.length ? details_set[0] : null;

            if (!details) {
                  log.warn(`Category not found for oid: ${categoryOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "Category not found",
                        data: null,
                  });
            }

            const statsSql = generate_stats_sql(categoryOid);
            const stats_set = await get_data(statsSql);
            const stats = stats_set.length ? stats_set[0] : {
                  totalProducts: 0,
                  activeProducts: 0,
                  amountSpent: 0,
                  totalAvailableQuantity: 0,
                  lowStockItems: 0,
                  outOfStockItems: 0,
                  averageProductPrice: 0
            };

            const activity_set = await getLogActivities('category', categoryOid, 10);

            const responseData = {
                  details: details,
                  stats: {
                        totalProducts: parseInt(stats.totalproducts) || 0,
                        activeProducts: parseInt(stats.activeproducts) || 0,
                        amountSpent: parseFloat(stats.amountspent) || 0,
                        totalAvailableQuantity: parseInt(stats.totalavailablequantity) || 0,
                        lowStockItems: parseInt(stats.lowstockitems) || 0,
                        outOfStockItems: parseInt(stats.outofstockitems) || 0,
                        averageProductPrice: parseFloat(stats.averageproductprice) || 0
                  },
                  // The oid rides along so the timeline can be keyed on it. Keyed on the timestamp,
                  // two entries recorded in the same millisecond collided and one of them vanished.
                  activity: activity_set.map(a => ({
                        oid: a.oid,
                        date: a.performed_on,
                        user: a.performed_by,
                        action: a.title,
                        description: a.description
                  }))
            };

            log.info(`Category details found for oid: ${categoryOid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Category details found successfully",
                  data: responseData,
            });
      } catch (e) {
            log.error(`An exception occurred while getting category details: ${e?.message}`);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_details_sql = (categoryOid) => {
      const query = `
            SELECT 
                  oid, 
                  name, 
                  description, 
                  status, 
                  category_code, 
                  created_by, 
                  created_on, 
                  edited_by, 
                  edited_on,
                  COALESCE(edited_on, created_on) AS last_action_on,
                  COALESCE(edited_by, created_by) AS last_action_by
            FROM ${TABLE.CATEGORIES} 
            WHERE oid = $1
      `;
      return { text: query, values: [categoryOid] };
};

// Quantities are sellable, not on hand: quantity_available minus the Active stock_hold rows, the
// same expression the POS picker uses. Counting held units meant a category with 12 on hand and 8
// promised to online orders read as 12 in stock and nothing low, so nobody reordered and the next
// counter sale was refused by the guarded deduct.
//
// Clamped at zero per batch. A disposal is approved against quantity_available alone and does not
// release the holds it invalidates, so on hand can fall below what is held. Unclamped, that batch
// carried a negative into the category total, eating another product's real stock, and the oversold
// product matched neither the low arm (not > 0) nor the out arm (not = 0), so the one product that
// cannot be fulfilled was the one no card named. Releasing those holds is the disposal's job.
//
// Every batch counts, whatever its status. Not everything a business buys is for sale: packaging,
// delivery materials and office supplies are bought, stored and run out exactly like stock, and
// their batches are `internal_use` with no selling price. Admitting only the two for-sale statuses
// meant a Packaging category reported nothing in it at all.
//
// The money figure is what was SPENT, from cost_price, not what the stock might sell for. cost_price
// is on every batch and selling_price is not, so a spend figure covers the same batches as the
// quantity beside it. Valuing at selling_price left a category holding one unpriced 40 unit batch
// reading "40 units, worth 0", and it would have put a sale price on a bag nobody sells.
//
// Spend is taken over quantity_available, the stock physically there, not over the sellable figure
// beside it, and each batch is multiplied by its own cost_price because the same product is bought
// at different prices. A hold is a promise, not a purchase: over the sellable figure the spend on
// 12 units bought at 500 read 2,000 while 8 were held and 6,000 again when that order was
// cancelled, so a number labelled "spent" moved 4,000 with nothing bought or sold in between.
//
// The average price is weighted by units and covers only batches that carry a selling price. It was
// an unweighted average of per-product averages, so a one unit batch counted as much as a five
// hundred unit one and the answer was not an average of anything a customer pays.
const generate_stats_sql = (categoryOid) => {
      const query = `
            WITH holds AS (
                  SELECT inventory_oid, SUM(quantity)::int AS held
                  FROM ${TABLE.STOCK_HOLD}
                  WHERE status = 'Active'
                  GROUP BY inventory_oid
            ),
            product_inventory AS (
                  SELECT 
                        p.oid as product_oid,
                        p.status,
                        p.is_deleted,
                        p.restock_threshold,
                        COALESCE(SUM(GREATEST(i.quantity_available - COALESCE(h.held, 0), 0)), 0) as total_quantity,
                        ROUND(COALESCE(SUM(i.quantity_available * i.cost_price), 0)::numeric, 2) as amount_spent,
                        COALESCE(SUM(i.quantity_available * i.selling_price) FILTER (WHERE i.selling_price IS NOT NULL), 0) as priced_value,
                        COALESCE(SUM(i.quantity_available) FILTER (WHERE i.selling_price IS NOT NULL), 0) as priced_units
                  FROM ${TABLE.PRODUCT} p
                  LEFT JOIN ${TABLE.INVENTORY} i ON p.oid = i.product_oid 
                  LEFT JOIN holds h ON h.inventory_oid = i.oid
                  WHERE p.category_oid = $1
                        AND p.is_deleted = FALSE
                  GROUP BY p.oid, p.status, p.is_deleted, p.restock_threshold
            )
            SELECT 
                  COUNT(*) as totalProducts,
                  COUNT(CASE WHEN status = 'Active' AND is_deleted = FALSE THEN 1 END) as activeProducts,
                  ROUND(COALESCE(SUM(amount_spent), 0)::numeric, 2) as amountSpent,
                  COALESCE(SUM(total_quantity), 0) as totalAvailableQuantity,
                  COUNT(CASE 
                        WHEN total_quantity > 0 
                        AND total_quantity <= restock_threshold 
                        AND status = 'Active' 
                        AND is_deleted = FALSE
                        THEN 1 
                  END) as lowStockItems,
                  COUNT(CASE 
                        WHEN total_quantity = 0 
                        AND status = 'Active' 
                        AND is_deleted = FALSE
                        THEN 1 
                  END) as outOfStockItems,
                  ROUND(COALESCE(SUM(priced_value) / NULLIF(SUM(priced_units), 0), 0)::numeric, 2) as averageProductPrice
            FROM product_inventory
      `;
      return { text: query, values: [categoryOid] };
};

module.exports = get_category_details;
