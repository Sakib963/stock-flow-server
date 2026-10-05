const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { lookup_customer } = require("../utils/lookup");

// Phone first (sales REQ-31 to REQ-33). An unknown phone is an answer too, not an error: it means a
// new customer.
const find_customer_by_phone = async (request, res) => {
    const { phone } = request.body;
    try {
        const found = await lookup_customer(phone, await channels_of(request));
        if (!found) return res.status(200).json({ code: 200, message: "No customer with this phone", data: { phone, customer: null } });
        return res.status(200).json({ code: 200, message: "Customer found", data: { phone, ...found } });
    } catch (e) {
        log.error(`An exception occurred while looking up a customer by phone: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not look up this phone. Try again in a moment." });
    }
};

module.exports = find_customer_by_phone;
