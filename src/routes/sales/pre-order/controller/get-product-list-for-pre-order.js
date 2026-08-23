const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Product feed for the pre-order form (FR-1).
//
// This exists because the POS feed cannot serve it: POS selects FROM inventory
// filtered to intended_use = 'for_sale', so it structurally cannot return a
// product with no batches -- which is exactly the product a pre-order is for.
// Here we select FROM product and LEFT JOIN stock, so zero-stock and
// never-stocked products are included.
const get_product_list_for_pre_order = async (request, res) => {
    try {
        const data_set = await get_data(generate_data_sql(request));
        const data = data_set.length ? data_set : [];
        log.info(`Pre-order product list found: ${data.length}`);
        return res.status(200).json({ code: 200, message: "Product list found", data });
    } catch (e) {
        log.error(`An exception occurred while getting pre-order product list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

const generate_data_sql = (request) => {
    const values = [];
    let query = `
        WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE}),
        last_price AS (
            SELECT product_oid, MAX(selling_price) AS selling_price
              FROM ${TABLE.INVENTORY}
             WHERE intended_use = 'for_sale'
             GROUP BY product_oid
        )
        SELECT p.oid AS product_oid,
               p.name AS product_name,
               p.sku,
               p.photo AS image_url,
               c.name AS category_name,
               sc.name AS sub_category_name,
               COALESCE(s.sellable_quantity, 0) AS sellable_quantity,
               CAST(COALESCE(lp.selling_price, 0) AS INTEGER) AS selling_price
          FROM ${TABLE.PRODUCT} p
          LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
          LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
          LEFT JOIN sellable s ON s.product_oid = p.oid
          LEFT JOIN last_price lp ON lp.product_oid = p.oid
         WHERE p.is_deleted = FALSE
    `;

    if (request.query.search_text && request.query.search_text.trim() !== "") {
        const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
        values.push(searchText, searchText, searchText, searchText);
        query += `
           AND (
                LOWER(p.name) LIKE $${values.length - 3} OR
                LOWER(p.sku) LIKE $${values.length - 2} OR
                LOWER(c.name) LIKE $${values.length - 1} OR
                LOWER(sc.name) LIKE $${values.length}
           )
        `;
    }

    query += ` ORDER BY p.name ASC`;
    return { text: query, values };
};

module.exports = get_product_list_for_pre_order;
