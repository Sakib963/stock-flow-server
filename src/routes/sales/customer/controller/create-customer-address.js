const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { insert_address, describe_address } = require("../utils/address");

// A family shares a phone and a customer sends gifts, so one customer has many addresses, each
// with its own recipient (sales REQ-61).
const create_customer_address = async (request, res) => {
    const { customer_oid, ...address } = request.body;
    try {
        const added = await execute_transaction(async (tx) => {
            const [customer] = await tx.get_data({ text: `SELECT oid FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [customer_oid] });
            if (!customer) fail(404, "That customer no longer exists.");

            const result = await insert_address(tx, customer_oid, address, request.credentials.user_id);
            await saveLogActivity({ reference_type: "customer", reference_oid: customer_oid, title: "Added address", description: describe_address(address) }, { tx, request });
            return result;
        });
        return res.status(200).json({ code: 200, message: "Address saved", data: added });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while adding an address to customer ${customer_oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the address. Try again in a moment." });
    }
};

module.exports = create_customer_address;
