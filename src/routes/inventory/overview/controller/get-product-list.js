const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list = async (request, res) => {
  try {
    const [countResult, data_set] = await Promise.all([
      get_data(generate_count_sql(request)),
      get_data(generate_data_sql(request)),
    ]);

    const total = countResult[0]?.total || 0;
    const data = data_set.length ? data_set : [];

    log.info(`Inventory overview list found: ${data.length} of ${total}`);
    return res.status(200).json({ code: 200, message: "Inventory overview list found", total, data });
  } catch (e) {
    log.error(`An exception occurred while getting inventory overview list: ${e?.message}`);
    return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
  }
};

const build_filters = (query, values = []) => {
  let whereClause = "";

  if (query.search_text && query.search_text.trim() !== "") {
    const searchText = `%${query.search_text.trim().toLowerCase()}%`;
    whereClause += ` AND (LOWER(p.name) LIKE $${values.length + 1} OR LOWER(bd.batch_code) LIKE $${values.length + 2})`;
    values.push(searchText, searchText);
  }

  if (query.status && query.status.trim() !== "" && query.status.trim().toLowerCase() !== "null") {
    whereClause += ` AND p.status = $${values.length + 1}`;
    values.push(query.status);
  }

  if (query.category_oid && query.category_oid.trim() !== "" && query.category_oid.trim().toLowerCase() !== "null") {
    whereClause += ` AND c.oid = $${values.length + 1}`;
    values.push(query.category_oid);
  }

  if (query.sub_category_oid && query.sub_category_oid.trim() !== "" && query.sub_category_oid.trim().toLowerCase() !== "null") {
    whereClause += ` AND s.oid = $${values.length + 1}`;
    values.push(query.sub_category_oid);
  }

  if (query.brand_oid && query.brand_oid.trim() !== "" && query.brand_oid.trim().toLowerCase() !== "null") {
    whereClause += ` AND b.oid = $${values.length + 1}`;
    values.push(query.brand_oid);
  }

  return { whereClause, values };
};

const generate_count_sql = (request) => {
  const { whereClause, values } = build_filters(request.query);
  const query = `
    SELECT COUNT(DISTINCT p.oid) AS total
    FROM ${TABLE.PRODUCT} p
    INNER JOIN ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid
    LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
    LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
    LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
    WHERE p.status = 'Active' AND p.is_deleted = FALSE${whereClause}
  `;
  return { text: query, values };
};

const generate_data_sql = (request) => {
  const { whereClause, values } = build_filters(request.query);
  let query = `
    SELECT
          p.oid AS product_oid,
          p.name AS product_name,
          p.restock_threshold,
          p.photo,
          COALESCE(COUNT(DISTINCT bd.batch_code), 0) AS total_batches,
          COALESCE(SUM(bd.quantity_available)::INTEGER, 0) AS total_available_quantity,
          BOOL_OR(bd.status = 'pending_pricing') AS has_pending_pricing,
          BOOL_OR(bd.intended_use = 'for_sale') AS has_for_sale_batch,
          COALESCE(SUM(bd.quantity_available * bd.cost_price), 0) AS total_stock_cost,
          COALESCE(SUM(
                CASE
                      WHEN bd.intended_use = 'for_sale' AND bd.status = 'ready_for_sale' AND bd.selling_price IS NOT NULL
                      THEN bd.quantity_available * bd.selling_price
                      ELSE 0
                END
          ), 0) AS expected_revenue,
          COALESCE(SUM(
                CASE
                      WHEN bd.intended_use = 'for_sale' AND bd.status = 'ready_for_sale' AND bd.selling_price IS NOT NULL
                      THEN bd.quantity_available * bd.selling_price
                      ELSE 0
                END
          ), 0) - COALESCE(SUM(
                CASE
                      WHEN bd.intended_use = 'for_sale'
                      THEN bd.quantity_available * bd.cost_price
                      ELSE 0
                END
          ), 0) AS potential_profit
    FROM ${TABLE.PRODUCT} p
    INNER JOIN ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid
    LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
    LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
    LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
    WHERE p.status = 'Active' AND p.is_deleted = FALSE${whereClause}
    GROUP BY p.oid, p.name, p.restock_threshold, p.photo, p.status
    ORDER BY p.name ASC
  `;

  if (request.query.limit) {
    query += ` LIMIT $${values.length + 1}`;
    values.push(Number(request.query.limit));
  }
  if (request.query.offset) {
    query += ` OFFSET $${values.length + 1}`;
    values.push(Number(request.query.offset));
  }

  return { text: query, values };
};

module.exports = get_product_list;
