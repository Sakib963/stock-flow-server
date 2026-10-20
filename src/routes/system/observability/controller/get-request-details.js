const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { parse_device } = require("../../../activity-log/utils/activity-kinds");
const { FROM } = require("../utils/request-where");

const get_request_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const [rows, activity] = await Promise.all([
            get_data({ text: `SELECT r.*, l.name, l.email FROM ${FROM} WHERE r.oid = $1`, values: [oid] }),
            get_data({ text: `SELECT oid, reference_type, title, description, performed_on FROM ${TABLE.ACTIVITY_LOG} WHERE request_id = $1 ORDER BY performed_on`, values: [oid] }),
        ]);
        if (!rows.length) return res.status(404).json({ code: 404, message: "That request is not in the log.", data: null });
        return res.status(200).json({ code: 200, message: "Request", data: { ...rows[0], device: parse_device(rows[0].device), activity } });
    } catch (e) {
        log.error(`An exception occurred while reading a request: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the request. Try again in a moment." });
    }
};

module.exports = get_request_details;
