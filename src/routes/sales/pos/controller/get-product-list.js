const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Batches a counter can sell, found by product name, SKU or batch code (sales REQ-13). Availability is
// sellable, on hand less Active holds. A scanned SKU or batch code that matches exactly comes first,
// so the scanner's line is the first result (REQ-14).
const get_product_list = async (request, res) => {
    try {
        const data = await get_data(generate_data_sql(request.query.search_text));
        return res.status(200).json({ code: 200, message: "Product list for sale found", data });
    } catch (e) {
        log.error(`An exception occurred while getting POS product list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not search the products. Try again in a moment." });
    }
};

const generate_data_sql = (search_text) => {
    const search = search_text?.trim().toLowerCase() || null;
    return {
        text: `SELECT p.oid AS product_oid, p.name AS product_name, p.photo AS image_url, p.sku,
                      i.oid AS inventory_oid, i.batch_code, i.expiry_date,
                      i.quantity_available::int AS quantity_available,
                      (i.quantity_available - COALESCE(h.held, 0))::int AS sellable_quantity,
                      i.selling_price::int AS selling_price, COALESCE(i.maximum_discount, 0)::int AS maximum_discount
                 FROM ${TABLE.INVENTORY} i
                 JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid AND p.is_deleted = false
            LEFT JOIN (SELECT inventory_oid, SUM(quantity) AS held FROM ${TABLE.STOCK_HOLD} WHERE status = 'Active' GROUP BY inventory_oid) h ON h.inventory_oid = i.oid
                WHERE i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
                  AND (i.quantity_available - COALESCE(h.held, 0)) > 0
                  AND ($1::text IS NULL OR LOWER(p.name) LIKE '%' || $1 || '%' OR LOWER(p.sku) LIKE '%' || $1 || '%' OR LOWER(i.batch_code) LIKE '%' || $1 || '%')
             ORDER BY (LOWER(p.sku) = $1 OR LOWER(i.batch_code) = $1) DESC NULLS LAST, p.name, i.expiry_date NULLS LAST, i.batch_code
                LIMIT 50`,
        values: [search],
    };
};

module.exports = get_product_list;
