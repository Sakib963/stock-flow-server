const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Unified order list (POS + online). Filter by channel, status, order_type, date
// range, and free text on invoice/customer.
const get_order_list = async (request, res) => {
    try {
        const [countResult, data_set] = await Promise.all([
            get_data(generate_count_sql(request)),
            get_data(generate_data_sql(request)),
        ]);
        const total = countResult[0]?.total || 0;
        const data = data_set.length ? data_set : [];
        log.info(`Order list found: ${data.length} of ${total}`);
        return res.status(200).json({ code: 200, message: "Order list found", total, data });
    } catch (e) {
        log.error(`An exception occurred while getting order list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

const build_filters = (query) => {
    const values = [];
    let where = " WHERE 1=1";

    if (query.channel && query.channel.trim() && query.channel.toLowerCase() !== "null") {
        values.push(query.channel);
        where += ` AND o.channel = $${values.length}`;
    }
    if (query.order_type && query.order_type.trim() && query.order_type.toLowerCase() !== "null") {
        values.push(query.order_type);
        where += ` AND o.order_type = $${values.length}`;
    }
    if (query.status && query.status.trim() && query.status.toLowerCase() !== "null") {
        values.push(query.status);
        where += ` AND o.status = $${values.length}`;
    }
    if (query.date_from && query.date_from !== "null") {
        values.push(query.date_from);
        where += ` AND o.created_on::date >= $${values.length}`;
    }
    if (query.date_to && query.date_to !== "null") {
        values.push(query.date_to);
        where += ` AND o.created_on::date <= $${values.length}`;
    }
    if (query.search_text && query.search_text.trim() !== "") {
        const s = `%${query.search_text.trim().toLowerCase()}%`;
        values.push(s, s);
        where += ` AND (LOWER(o.invoice_no) LIKE $${values.length - 1} OR LOWER(o.customer_name) LIKE $${values.length})`;
    }
    return { where, values };
};

const generate_count_sql = (request) => {
    const { where, values } = build_filters(request.query);
    return { text: `SELECT COUNT(*) AS total FROM ${TABLE.ORDERS} o${where}`, values };
};

const generate_data_sql = (request) => {
    const { where, values } = build_filters(request.query);
    let query = `
    SELECT o.oid, o.invoice_no, o.channel, o.order_type, o.status,
           o.customer_name, o.customer_phone,
           CAST(o.total_amount AS INTEGER) AS total_amount,
           o.payment_type, o.payment_status,
           o.dispatched_on, o.delivered_on, o.created_on, o.created_by,
           COUNT(oi.oid) AS item_count
    FROM ${TABLE.ORDERS} o
    LEFT JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
    ${where}
    GROUP BY o.oid
    ORDER BY o.created_on DESC
  `;
    if (request.query.limit) {
        values.push(Number(request.query.limit));
        query += ` LIMIT $${values.length}`;
    }
    if (request.query.offset) {
        values.push(Number(request.query.offset));
        query += ` OFFSET $${values.length}`;
    }
    return { text: query, values };
};

module.exports = get_order_list;
