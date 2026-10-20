const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { parse_device } = require("../../../activity-log/utils/activity-kinds");
const { FROM, request_where } = require("../utils/request-where");

const STATUS_CLASS = (status) => `${Math.floor(status / 100)}xx`;

const shape = (row) => {
    const device = parse_device(row.device);
    return { ...row, device, device_name: device ? [device.browser, device.os].filter(Boolean).join(" · ") : null, endpoint: `${row.method} ${row.route}`, status_class: STATUS_CLASS(row.status) };
};

const get_request_list = async (request, res) => {
    const { query } = request;
    try {
        const { where, values } = request_where(query);
        const [rows, [{ total }]] = await Promise.all([
            get_data({
                text: `SELECT r.oid, r.occurred_on, r.method, r.route, r.path, r.unmatched_route, r.status, r.duration_ms, r.ip, r.country, r.city, r.device, r.login_oid, l.name, l.email
                         FROM ${FROM} ${where}
                        ORDER BY r.occurred_on DESC, r.oid DESC
                        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                values: [...values, query.limit, query.offset],
            }),
            get_data({ text: `SELECT COUNT(*)::int AS total FROM ${FROM} ${where}`, values }),
        ]);
        return res.status(200).json({ code: 200, message: "Requests", data: { rows: rows.map(shape) }, total });
    } catch (e) {
        log.error(`An exception occurred while reading the request log: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the request log. Try again in a moment." });
    }
};

module.exports = get_request_list;
