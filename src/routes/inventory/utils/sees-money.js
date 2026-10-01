const { permissions_for } = require("../../../middleware/require-permission");

// Buying price, budgets and value go only to someone who may see them; the rest of a response stays.
const sees_money = async (request) => (await permissions_for(request.credentials.user_id)).has("inventory.stock-value.view");

module.exports = { sees_money };
