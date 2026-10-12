const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { AREA, ATTENTION, RECORD_EXISTS, FROM, activity_where, parse_device } = require("../utils/activity-kinds");

// The feed, newest first, one numbered page at a time with the total for the pager: who did it
// (their name, not just the address), what, in which area, whether it is worth a second look,
// whether its record still exists to open, and the device it came from, read from the request it
// was written in.
const get_activity_log_list = async (request, res) => {
    const { query } = request;
    try {
        const { where, values } = activity_where(query);
        const limit = Number(query.limit ?? 30);
        const offset = Number(query.offset ?? 0);
        const [rows, [{ total }]] = await Promise.all([
            get_data({
                text: `SELECT a.oid, a.reference_type, a.reference_oid, a.title, a.description, a.performed_by, a.performed_on,
                              l.name AS performed_by_name, ${AREA} AS area, ${ATTENTION} AS attention, ${RECORD_EXISTS} AS record_exists,
                              r.device, r.city
                         FROM ${FROM}
                         LEFT JOIN ${TABLE.API_REQUEST_LOG} r ON r.oid = a.request_id
                         ${where}
                        ORDER BY a.performed_on DESC, a.oid
                        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                values: [...values, limit, offset],
            }),
            get_data({ text: `SELECT COUNT(*)::int AS total FROM ${FROM} ${where}`, values }),
        ]);
        const page = rows.map((row) => ({ ...row, device: parse_device(row.device) }));
        return res.status(200).json({ code: 200, message: "Activity", data: { rows: page }, total });
    } catch (e) {
        log.error(`An exception occurred while reading the activity log: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the activity. Try again in a moment." });
    }
};

module.exports = get_activity_log_list;
