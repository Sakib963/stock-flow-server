const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { customer_stats, customer_orders } = require("./customer-history");
const { read_addresses, sees_addresses } = require("./address");

// What a phone tells the person selling (sales REQ-31 to REQ-33): the customer, their saved addresses
// default first, their own history and last orders. Null when the phone is new.
const lookup_customer = async (phone, channels) => {
    const [customer] = await get_data({
        text: `SELECT oid, name, phone, gender, age_band, flag, flag_reason, status, first_source_oid FROM ${TABLE.CUSTOMERS} WHERE phone_normalized = $1`,
        values: [phone],
    });
    if (!customer) return null;
    const [addresses, history, last_orders] = await Promise.all([sees_addresses(channels) ? read_addresses(customer.oid) : null, customer_stats(customer.oid, channels), customer_orders(customer.oid, channels, 5)]);
    return { customer, addresses, history, last_orders };
};

module.exports = { lookup_customer };
