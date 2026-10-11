const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { READY, IN_A_BATCH, ORDER_COLUMNS, ORDER_FROM } = require("../utils/batch-orders");

// New batch proposes every order ready to send and in no other batch, oldest first (REQ-02).
const get_orders_ready_to_send = async (request, res) => {
    try {
        const rows = await get_data({ text: `SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM} WHERE ${READY} AND NOT ${IN_A_BATCH} ORDER BY o.created_on, o.oid LIMIT 500`, values: [] });
        return res.status(200).json({ code: 200, message: "Orders ready to send", data: rows });
    } catch (e) {
        log.error(`An exception occurred while listing orders ready to send: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the orders ready to send. Try again in a moment." });
    }
};

module.exports = get_orders_ready_to_send;
