const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Every message template, for the settings page to edit and for an order page to fill (sales REQ-90, REQ-91).
const get_message_templates = async (request, res) => {
    try {
        const data = await get_data({
            text: `SELECT oid, name, language, body, order_statuses, status, created_on, edited_on FROM ${TABLE.MESSAGE_TEMPLATE} ORDER BY status, name`,
        });
        return res.status(200).json({ code: 200, message: "Message templates found", data });
    } catch (e) {
        log.error(`An exception occurred while reading message templates: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the message templates. Try again in a moment." });
    }
};

module.exports = get_message_templates;
