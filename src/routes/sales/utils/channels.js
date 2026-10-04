const { permissions_for } = require("../../../middleware/require-permission");

// The channels a person sells through come from their grants, never from a setting that could
// disagree with them (sales REQ-01). Every order and sales figure is filtered to these (REQ-02).
const channels_of = async (request) => {
    const held = await permissions_for(request.credentials.user_id);
    return [held.has("sales.pos.view") && "POS", held.has("sales.online.view") && "ONLINE"].filter(Boolean);
};

module.exports = { channels_of };
