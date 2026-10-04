const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { customer_stats, customer_orders } = require("../utils/customer-history");
const { read_addresses } = require("../utils/address");

// Phone first (sales REQ-31 to REQ-33): a known phone brings the customer, their saved addresses
// with the default first, their own history and last orders, so nobody retypes an address. An
// unknown phone is an answer too, not an error: it means a new customer.
const find_customer_by_phone = async (request, res) => {
    const { phone } = request.body;
    try {
        const [customer] = await get_data({
            text: `SELECT oid, name, phone, gender, age_band, flag, flag_reason, status, first_source_oid FROM ${TABLE.CUSTOMERS} WHERE phone_normalized = $1`,
            values: [phone],
        });
        if (!customer) return res.status(200).json({ code: 200, message: "No customer with this phone", data: { phone, customer: null } });

        const channels = await channels_of(request);
        const [addresses, history, last_orders] = await Promise.all([read_addresses(customer.oid), customer_stats(customer.oid, channels), customer_orders(customer.oid, channels, 5)]);
        return res.status(200).json({ code: 200, message: "Customer found", data: { phone, customer, addresses, history, last_orders } });
    } catch (e) {
        log.error(`An exception occurred while looking up a customer by phone: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not look up this phone. Try again in a moment." });
    }
};

module.exports = find_customer_by_phone;
