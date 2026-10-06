const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_orders_for_form } = require("../utils/order-for-form");

// Every online draft the person saved, so a resumed draft shows what changed while it waited.
const get_online_drafts = async (request, res) => {
    try {
        const data = await read_orders_for_form(get_data, "o.status = 'Draft' AND o.created_by = $1", [request.credentials.user_id]);
        return res.status(200).json({ code: 200, message: "Online drafts found", data });
    } catch (e) {
        log.error(`An exception occurred while reading online drafts: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the drafts. Try again in a moment." });
    }
};

module.exports = get_online_drafts;
