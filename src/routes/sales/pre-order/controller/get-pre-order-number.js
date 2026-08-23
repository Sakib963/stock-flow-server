const { get_data } = require("../../../../utils/database");
const { nextPreOrderNo } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Next PRE-YYMMDD-NNNN. Counted over `pre_orders` only, so bookings never consume
// an order invoice number (FR-9, FR-45).
const get_pre_order_number = async (request, res) => {
    try {
        const preorder_no = await nextPreOrderNo(get_data);
        log.info(`Next pre-order number: ${preorder_no}`);
        return res.status(200).json({ code: 200, message: "Pre-order number generated", data: { preorder_no } });
    } catch (e) {
        log.error(`An exception occurred while generating pre-order number: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_pre_order_number;
