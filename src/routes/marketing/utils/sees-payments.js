const { permissions_for } = require("../../../middleware/require-permission");

// Payments to partners and what is owed go only to someone who may see them (promotion campaign REQ-13).
const sees_payments = async (request) => (await permissions_for(request.credentials.user_id)).has("marketing.partner-payment.view");

module.exports = { sees_payments };
