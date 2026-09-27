const { log } = require("../../../../utils/log");
const { permissions_for } = require("../../../../middleware/require-permission");
const { read_configuration_analytics } = require("../utils/configuration-analytics");

const get_configuration_analytics = async (request, res) => {
      try {
            const held = await permissions_for(request.credentials.user_id);
            const data = await read_configuration_analytics(held);
            return res.status(200).json({ code: 200, message: "Configuration analytics fetched successfully", data });
      } catch (e) {
            log.error(`An exception occurred while getting configuration analytics: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_configuration_analytics;
