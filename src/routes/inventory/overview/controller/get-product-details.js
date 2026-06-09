const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_details = async (request, res) => {
  try {
    const product_oid = request.query.product_oid;

    const [product_set, batch_set] = await Promise.all([
      get_data(generate_product_sql(product_oid)),
      get_data(generate_batch_sql(product_oid)),
    ]);

    const product_data = product_set.length ? product_set[0] : null;

    if (!product_data) {
      log.warn(`Product not found for oid: ${product_oid}`);
      return res.status(404).json({ code: 404, message: "Product not found", data: null });
    }

    log.info(`Inventory overview product details found for oid: ${product_oid}`);
    return res.status(200).json({
      code: 200,
      message: "Product details found",
      data: {
        ...product_data,
        batch_data: batch_set.length ? batch_set : [],
      },
    });
  } catch (e) {
    log.error(`An exception occurred while getting product details: ${e?.message}`);
    return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
  }
};

const generate_product_sql = (product_oid) => {
  const query = `
    SELECT
          p.oid, p.name, p.sku, p.category_oid, p.sub_category_oid, p.unit_type,
          p.description, p.photo, p.product_nature, p.restock_threshold, p.status,
          c.name AS category_name, sc.name AS sub_category_name
    FROM ${TABLE.PRODUCT} p
    LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
    LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
    WHERE p.oid = $1
  `;
  return { text: query, values: [product_oid] };
};

const generate_batch_sql = (product_oid) => {
  const query = `
    SELECT
          i.oid AS inventory_oid,
          i.batch_code,
          i.intended_use,
          i.status,
          CAST(i.cost_price AS INTEGER) AS cost_price,
          CAST(i.selling_price AS INTEGER) AS selling_price,
          CAST(i.maximum_discount AS INTEGER) AS maximum_discount,
          CAST(i.initial_quantity AS INTEGER) AS initial_quantity,
          CAST(i.quantity_available AS INTEGER) AS quantity_available,
          s.name AS supplier_name,
          w.name AS warehouse_name,
          a.name AS aisle_name,
          CAST(pcp.ad_run_cost AS INTEGER) AS ad_run_cost,
          CAST(pcp.packaging_cost AS INTEGER) AS packaging_cost,
          CAST(pcp.gift_cost AS INTEGER) AS gift_cost,
          CAST(pcp.content_creation_cost AS INTEGER) AS content_creation_cost,
          CAST(pcp.influencer_cost AS INTEGER) AS influencer_cost,
          pcp.cost_remarks,
          CAST(i.quantity_available * i.cost_price AS INTEGER) AS total_stock_cost,
          CASE
                WHEN i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
                THEN CAST(i.quantity_available * i.selling_price AS INTEGER)
                ELSE 0
          END AS expected_revenue,
          CASE
                WHEN i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
                THEN CAST(i.quantity_available * (i.selling_price - i.cost_price) AS INTEGER)
                ELSE 0
          END AS potential_profit
    FROM ${TABLE.INVENTORY} i
    LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
    LEFT JOIN ${TABLE.PURCHASE_DETAILS_COST_PROFILE} pcp ON pcp.purchase_details_oid = pd.oid
    LEFT JOIN ${TABLE.PURCHASE} p ON p.oid = pd.purchase_oid
    LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid
    LEFT JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid
    LEFT JOIN ${TABLE.SUPPLIER} s ON s.oid = p.supplier_oid
    WHERE i.product_oid = $1
    ORDER BY i.batch_code ASC
  `;
  return { text: query, values: [product_oid] };
};

module.exports = get_product_details;
