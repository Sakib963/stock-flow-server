const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { deliverOrder } = require("../../utils/order-moves");

const deliver_order = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction((tx) => deliverOrder(tx, { oid, user_id, request }));
        log.info(`Online order ${invoice_no} delivered, recorded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Delivered", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while delivering an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not marked delivered. Try again in a moment." });
    }
};

module.exports = deliver_order;
