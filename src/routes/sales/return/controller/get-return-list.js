const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Returns list. Every return is rooted in an order, so the order supplies the
// customer, the channel and the invoice the return is filed against.
const get_return_list = async (request, res) => {
    try {
        const countResult = await get_data(generate_count_sql(request));
        const total = Number(countResult[0]?.total || 0);

        const data_set = await get_data(generate_data_sql(request));
        const data = data_set.length ? data_set : [];

        log.info(`Return list found: ${data.length} of ${total}`);
        return res.status(200).json({ code: 200, message: "Return list found", total, data });
    } catch (e) {
        log.error(`An exception occurred while getting the return list: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

// Filters are shared by the count and the page so the two can never disagree.
const apply_filters = (request, values) => {
    let clause = "";

    if (request.query.status) {
        clause += ` AND pr.status = $${values.length + 1}`;
        values.push(request.query.status);
    }

    if (request.query.channel) {
        clause += ` AND o.channel = $${values.length + 1}`;
        values.push(request.query.channel);
    }

    if (request.query.date_from) {
        clause += ` AND pr.created_on >= $${values.length + 1}`;
        values.push(request.query.date_from);
    }

    if (request.query.date_to) {
        // Inclusive of the whole end day.
        clause += ` AND pr.created_on < ($${values.length + 1}::date + INTERVAL '1 day')`;
        values.push(request.query.date_to);
    }

    if (request.query.search_text && request.query.search_text.trim() !== "") {
        const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
        clause += ` AND (LOWER(pr.invoice_no) LIKE $${values.length + 1}`;
        clause += ` OR LOWER(o.invoice_no) LIKE $${values.length + 2}`;
        clause += ` OR LOWER(o.customer_name) LIKE $${values.length + 3}`;
        clause += ` OR LOWER(o.customer_phone) LIKE $${values.length + 4})`;
        values.push(searchText, searchText, searchText, searchText);
    }

    return clause;
};

const generate_count_sql = (request) => {
    const values = [];
    const query = `SELECT COUNT(*) AS total
                     FROM ${TABLE.PRODUCT_RETURN} pr
                     JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
                    WHERE 1 = 1 ${apply_filters(request, values)}`;
    return { text: query, values };
};

const generate_data_sql = (request) => {
    const values = [];
    let query = `SELECT pr.oid,
                        pr.invoice_no AS return_no,
                        pr.order_oid,
                        o.invoice_no,
                        o.channel,
                        o.customer_name,
                        o.customer_phone,
                        CAST(pr.refund_amount AS INTEGER) AS refund_amount,
                        pr.return_reason,
                        pr.status,
                        pr.created_on,
                        COALESCE(l.name, pr.created_by) AS created_by,
                        COALESCE(u.units, 0)::int AS units,
                        COALESCE(u.line_count, 0)::int AS line_count
                   FROM ${TABLE.PRODUCT_RETURN} pr
                   JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
                   LEFT JOIN ${TABLE.LOGIN} l ON l.email = pr.created_by
                   LEFT JOIN (
                         SELECT return_oid,
                                SUM(return_quantity)::int AS units,
                                COUNT(*)::int AS line_count
                           FROM ${TABLE.RETURN_DETAILS}
                          GROUP BY return_oid
                   ) u ON u.return_oid = pr.oid
                  WHERE 1 = 1 ${apply_filters(request, values)}`;

    // Pending first: it is the only status that needs someone to act.
    query += ` ORDER BY CASE WHEN pr.status = 'Pending' THEN 0 ELSE 1 END, pr.created_on DESC`;

    if (request.query.offset) {
        query += ` OFFSET $${values.length + 1}`;
        values.push(Number(request.query.offset));
    }

    if (request.query.limit) {
        query += ` LIMIT $${values.length + 1}`;
        values.push(Number(request.query.limit));
    }

    return { text: query, values };
};

module.exports = get_return_list;
