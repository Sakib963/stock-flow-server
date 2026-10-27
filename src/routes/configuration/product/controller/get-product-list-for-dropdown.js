const { TABLE } = require("../../../../utils/constant");
const { read_choices } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Inactive products too: it names the products in a list filter, and an inactive one still has its history.
const get_product_list_for_dropdown = async (request, res) => {
    try {
        const data = await read_choices({
            select: "p.oid AS value, p.name AS label, p.sku",
            from: `${TABLE.PRODUCT} p`,
            key: "p.oid",
            where: ["p.is_deleted = FALSE"],
            search: ["p.name", "p.sku"],
            order: "p.name",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Products", data });
    } catch (e) {
        log.error(`An exception occurred while loading products for a dropdown: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load products. Try again in a moment." });
    }
};

module.exports = get_product_list_for_dropdown;
