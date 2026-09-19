const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../utils/list-query");
const { log } = require("../../../../utils/log");

const get_category_list = async (request, res) => {
    try {
        const { rows, total } = await read_list({
            select: "oid, name, description, category_code, status, created_on",
            from: TABLE.CATEGORIES,
            search: ["name", "category_code"],
            filters: { status: "status" },
            sortable: { name: "name", category_code: "category_code", status: "status", created_on: "created_on" },
            default_sort: { key: "name", order: "asc" },
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Categories", data: { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing categories: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load categories. Try again in a moment." });
    }
};

module.exports = get_category_list;
