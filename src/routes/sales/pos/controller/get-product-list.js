const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Product/batch feed for POS. Exposes both physical on-hand (quantity_available)
// and SELLABLE (on-hand minus Active holds). Availability is judged on sellable.
const get_product_list = async (request, res) => {
    try {
        const data_set = await get_data(generate_data_sql(request));
        const data = data_set.length ? data_set : [];
        log.info(`POS product list found: ${data.length}`);
        return res.status(200).json({ code: 200, message: "Product list for sale found", data });
    } catch (e) {
        log.error(`An exception occurred while getting POS product list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

const generate_data_sql = (request) => {
    const values = [];
    let query = `
    SELECT
      sc.oid AS sub_category_oid,
      sc.name AS sub_category_name,
      c.name AS category_name,
      c.category_code,
      p.oid AS product_oid,
      p.name AS product_name,
      p.photo AS image_url,
      p.sku,
      i.oid AS inventory_oid,
      i.batch_code,
      i.quantity_available,
      COALESCE(h.held, 0) AS held_quantity,
      (i.quantity_available - COALESCE(h.held, 0)) AS sellable_quantity,
      i.selling_price,
      i.maximum_discount
    FROM ${TABLE.INVENTORY} i
    LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
    LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
    LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
    LEFT JOIN (
      SELECT inventory_oid, SUM(quantity)::int AS held
      FROM ${TABLE.STOCK_HOLD}
      WHERE status = 'Active'
      GROUP BY inventory_oid
    ) h ON h.inventory_oid = i.oid
    WHERE i.intended_use = 'for_sale'
      AND i.status = 'ready_for_sale'
      AND (i.quantity_available - COALESCE(h.held, 0)) > 0
  `;

    if (request.query.search_text && request.query.search_text.trim() !== "") {
        const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
        values.push(searchText, searchText, searchText, searchText, searchText, searchText, searchText);
        query += `
      AND (
        LOWER(p.name) LIKE $${values.length - 6} OR
        LOWER(p.sku) LIKE $${values.length - 5} OR
        LOWER(c.name) LIKE $${values.length - 4} OR
        LOWER(c.category_code) LIKE $${values.length - 3} OR
        LOWER(sc.name) LIKE $${values.length - 2} OR
        LOWER(i.batch_code) LIKE $${values.length - 1} OR
        CAST(i.selling_price AS TEXT) LIKE $${values.length}
      )
    `;
    }

    query += ` ORDER BY sc.name, p.name, i.selling_price LIMIT 50`;
    return { text: query, values };
};

module.exports = get_product_list;
