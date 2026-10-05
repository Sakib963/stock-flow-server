const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { customer_stats, customer_orders } = require("../utils/customer-history");
const { read_addresses, sees_addresses, hides_address_activity } = require("../utils/address");

const DETAILS_SQL = `
    SELECT c.oid, c.name, c.phone, c.gender, c.age_band, c.flag, c.flag_reason, c.social_handle, c.note, c.status,
           c.first_source_oid, s.name AS first_source_name, s.platform AS first_source_platform,
           c.created_by, c.created_on, c.edited_by, c.edited_on,
           COALESCE(c.edited_on, c.created_on) AS last_action_on,
           COALESCE(c.edited_by, c.created_by) AS last_action_by
      FROM ${TABLE.CUSTOMERS} c
      LEFT JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = c.first_source_oid
     WHERE c.oid = $1`;

// The record page (sales REQ-66): details, numbers, addresses, orders and activity in one call.
const get_customer_details = async (request, res) => {
    const oid = request.params.oid;
    try {
        const [details] = await get_data({ text: DETAILS_SQL, values: [oid] });
        if (!details) return res.status(404).json({ code: 404, message: "That customer no longer exists.", data: null });

        const channels = await channels_of(request);
        const [stats, addresses, orders, activity] = await Promise.all([customer_stats(oid, channels), sees_addresses(channels) ? read_addresses(oid) : null, customer_orders(oid, channels, 20), getLogActivities("customer", oid, 10)]);

        return res.status(200).json({
            code: 200,
            message: "Customer details",
            data: {
                details,
                stats,
                addresses,
                orders,
                channels,
                activity: (sees_addresses(channels) ? activity : activity.filter(hides_address_activity)).map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
            },
        });
    } catch (e) {
        log.error(`An exception occurred while reading customer ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load this customer. Try again in a moment." });
    }
};

module.exports = get_customer_details;
