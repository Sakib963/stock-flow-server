const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Pre-order list. Reads ONLY `pre_orders` -- a pre-order is never an order, so
// this never touches the orders spine.
const get_pre_order_list = async (request, res) => {
    try {
        const [countResult, data_set] = await Promise.all([get_data(generate_count_sql(request)), get_data(generate_data_sql(request))]);

        const total = countResult[0]?.total || 0;
        const data = data_set.length ? data_set : [];

        log.info(`Pre-order list found: ${data.length} of ${total}`);
        return res.status(200).json({ code: 200, message: "Pre-order list found", total, data });
    } catch (e) {
        log.error(`An exception occurred while getting pre-order list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

const build_filters = (query) => {
    const values = [];
    let where = " WHERE 1 = 1";

    if (query.search_text && query.search_text.trim() !== "") {
        const searchText = `%${query.search_text.trim().toLowerCase()}%`;
        values.push(searchText, searchText, searchText);
        where += ` AND (LOWER(po.preorder_no) LIKE $${values.length - 2} OR LOWER(po.customer_name) LIKE $${values.length - 1} OR LOWER(po.customer_phone) LIKE $${values.length})`;
    }

    if (query.status && query.status.trim() && query.status.toLowerCase() !== "null") {
        values.push(query.status);
        where += ` AND po.status = $${values.length}`;
    }

    if (query.date_from && query.date_from !== "null") {
        values.push(query.date_from);
        where += ` AND po.created_on::date >= $${values.length}`;
    }

    if (query.date_to && query.date_to !== "null") {
        values.push(query.date_to);
        where += ` AND po.created_on::date <= $${values.length}`;
    }

    return { where, values };
};

const generate_count_sql = (request) => {
    const { where, values } = build_filters(request.query);
    return { text: `SELECT COUNT(*) AS total FROM ${TABLE.PRE_ORDERS} po${where}`, values };
};

const generate_data_sql = (request) => {
    const { where, values } = build_filters(request.query);

    let query = `
        SELECT po.oid,
               po.preorder_no,
               po.customer_name,
               po.customer_phone,
               CAST(po.total_amount AS INTEGER) AS total_amount,
               CAST(po.advance_paid AS INTEGER) AS advance_paid,
               CAST(po.total_amount - po.advance_paid AS INTEGER) AS advance_due,
               po.status,
               po.expected_date,
               po.created_on,
               po.created_by,
               COUNT(poi.oid) AS item_count
          FROM ${TABLE.PRE_ORDERS} po
          LEFT JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
          ${where}
         GROUP BY po.oid
         ORDER BY po.created_on DESC
    `;

    if (request.query.offset) {
        values.push(Number(request.query.offset));
        query += ` OFFSET $${values.length}`;
    }

    if (request.query.limit) {
        values.push(Number(request.query.limit));
        query += ` FETCH NEXT $${values.length} ROWS ONLY`;
    }

    return { text: query, values };
};

module.exports = get_pre_order_list;
