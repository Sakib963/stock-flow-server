const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { parse_device } = require("../../../activity-log/utils/activity-kinds");
const { FROM, request_where } = require("../utils/request-where");

const CRASH_ROUTE = CONTEXTS.PROFILE + SUB_CONTEXTS.CRASH_REPORT + ROUTES.REPORT_CRASH;

const get_crash_list = async (request, res) => {
    try {
        const { where, values } = request_where({ ...request.query, route: CRASH_ROUTE, status: "2xx" });
        const rows = await get_data({
            text: `SELECT r.oid, r.occurred_on, r.device, l.name, l.email, r.request_body->>'page' AS page, r.request_body->>'message' AS message, r.request_body->>'version' AS version
                     FROM ${FROM} ${where} ORDER BY r.occurred_on DESC, r.oid DESC LIMIT 200`,
            values,
        });
        return res.status(200).json({ code: 200, message: "Crashes", data: { rows: rows.map((row) => ({ ...row, device: parse_device(row.device) })) } });
    } catch (e) {
        log.error(`An exception occurred while reading crashes: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the crashes. Try again in a moment." });
    }
};

module.exports = get_crash_list;
