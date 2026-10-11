const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { dispatchOrder } = require("../../utils/order-moves");

const dispatch_order = async (request, res) => {
    const { oid, courier, consignment_no } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction((tx) => dispatchOrder(tx, { oid, courier, consignment_no, user_id, request }));
        log.info(`Online order ${invoice_no} dispatched by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Dispatched", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while dispatching an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not dispatched. Try again in a moment." });
    }
};

module.exports = dispatch_order;
