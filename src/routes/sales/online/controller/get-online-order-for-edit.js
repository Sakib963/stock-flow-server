const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_orders_for_form } = require("../utils/order-for-form");

// A Pending online order, to fill the order page for an edit (sales REQ-52). Once confirmed it is not editable.
const get_online_order_for_edit = async (request, res) => {
    try {
        const [order] = await read_orders_for_form(get_data, "o.status = 'Pending' AND o.oid = $1", [request.query.oid]);
        if (!order) return res.status(409).json({ code: 409, message: "Only an order waiting to be confirmed can be changed. Reload the order to see where it is now." });
        return res.status(200).json({ code: 200, message: "Order found", data: order });
    } catch (e) {
        log.error(`An exception occurred while reading an order to edit: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not open the order to change it. Try again in a moment." });
    }
};

module.exports = get_online_order_for_edit;
