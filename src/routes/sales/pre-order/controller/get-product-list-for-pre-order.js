const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { SELLABLE_BY_PRODUCT_CTE, priceHints } = require("../utils/pre-order-utils");

const HINTS = priceHints("p.oid");

// The whole catalogue, stock or not (REQ-01): the counter's search reads batches, so it cannot offer a
// product never bought. The price is a starting point for the approximate price, the highest a for-sale
// batch sells at.
const get_product_list_for_pre_order = async (request, res) => {
    try {
        const term = request.query.search?.trim();
        const values = [];
        let where = "";
        if (term) {
            values.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
            where = `AND (p.name ILIKE $1 OR p.sku ILIKE $1)`;
        }
        const rows = await get_data({
            text: `SELECT p.oid AS product_oid, p.name AS product_name, p.sku, COALESCE(s.sellable, 0) AS sellable, COALESCE(pr.price, 0)::int AS price, ${HINTS.select}
                     FROM ${TABLE.PRODUCT} p
                     LEFT JOIN (${SELLABLE_BY_PRODUCT_CTE}) s ON s.product_oid = p.oid
                     LEFT JOIN (SELECT product_oid, MAX(selling_price) AS price FROM ${TABLE.INVENTORY} WHERE intended_use = 'for_sale' GROUP BY product_oid) pr ON pr.product_oid = p.oid
                     ${HINTS.joins}
                    WHERE COALESCE(p.is_deleted, false) = false AND p.status = 'Active' ${where}
                    ORDER BY p.name LIMIT 30`,
            values,
        });
        if (!(await sees_money(request))) for (const row of rows) delete row.last_cost;
        return res.status(200).json({ code: 200, message: "Products", data: rows });
    } catch (e) {
        log.error(`An exception occurred while searching products for a booking: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not search the products. Try again in a moment." });
    }
};

module.exports = get_product_list_for_pre_order;
