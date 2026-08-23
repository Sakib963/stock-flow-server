const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Batches of ONE known product, for the per-line picker used during conversion
// (FR-24).
//
// This exists because `select-product` searches ALL batches globally by text and
// the POS feed accepts only `search_text` -- neither can answer "which batches
// exist for THIS line". The system must never guess which batch a booked line
// meant, so the admin picks from this list explicitly.
const get_batches_for_product = async (request, res) => {
    try {
        const product_oid = request.query.product_oid;

        const data = await get_data({
            text: `
                SELECT i.oid AS inventory_oid,
                       i.batch_code,
                       i.product_oid,
                       p.name AS product_name,
                       p.sku,
                       i.quantity_available,
                       COALESCE(h.held, 0) AS held_quantity,
                       (i.quantity_available - COALESCE(h.held, 0)) AS sellable_quantity,
                       CAST(i.selling_price AS INTEGER) AS selling_price,
                       CAST(COALESCE(i.maximum_discount, 0) AS INTEGER) AS maximum_discount,
                       CAST(i.cost_price AS INTEGER) AS cost_price,
                       i.created_on
                  FROM ${TABLE.INVENTORY} i
                  LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                  LEFT JOIN (
                        SELECT inventory_oid, SUM(quantity)::int AS held
                          FROM ${TABLE.STOCK_HOLD}
                         WHERE status = 'Active'
                         GROUP BY inventory_oid
                  ) h ON h.inventory_oid = i.oid
                 WHERE i.product_oid = $1
                   AND i.intended_use = 'for_sale'
                   AND i.status = 'ready_for_sale'
                   AND (i.quantity_available - COALESCE(h.held, 0)) > 0
                 ORDER BY i.created_on ASC
            `,
            values: [product_oid],
        });

        log.info(`Batches available for product ${product_oid}: ${data.length}`);
        return res.status(200).json({ code: 200, message: "Batches found", total: data.length, data });
    } catch (e) {
        log.error(`An exception occurred while getting batches for product: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_batches_for_product;
