const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");

// Which product column a group is read by. A lookup, so no column name ever comes from a caller.
const GROUP_COLUMN = {
      category: "category_oid",
      sub_category: "sub_category_oid",
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
// quantity beside it. Valuing at selling_price left a group holding one unpriced 40 unit batch
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
const product_stock_stats_sql = (group, oid) => {
      const column = GROUP_COLUMN[group];
      if (!column) throw new Error(`No product column for group "${group}"`);
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
                  WHERE p.${column} = $1
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
      return { text: query, values: [oid] };
};

/** The numbers a category or sub-category record page shows, for the group with this oid. */
const read_product_stock_stats = async (group, oid) => {
      const [stats = {}] = await get_data(product_stock_stats_sql(group, oid));
      return {
            totalProducts: parseInt(stats.totalproducts) || 0,
            activeProducts: parseInt(stats.activeproducts) || 0,
            amountSpent: parseFloat(stats.amountspent) || 0,
            totalAvailableQuantity: parseInt(stats.totalavailablequantity) || 0,
            lowStockItems: parseInt(stats.lowstockitems) || 0,
            outOfStockItems: parseInt(stats.outofstockitems) || 0,
            averageProductPrice: parseFloat(stats.averageproductprice) || 0,
      };
};

module.exports = { read_product_stock_stats };
