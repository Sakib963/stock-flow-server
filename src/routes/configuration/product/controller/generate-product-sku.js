const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { first_free_sku } = require("../utils/sku");

const generate_product_sku = async (request, res) => {
      const { name, oid } = request.query;

      try {
            const sku = await first_free_sku(get_data, name, oid || null);
            if (!sku) {
                  log.warn(`No SKU could be built from the given name`);
                  return res.status(400).json({ code: 400, message: "No SKU could be made from this name. Type one yourself." });
            }
            return res.status(200).json({ code: 200, message: "OK", data: { sku } });
      } catch (e) {
            log.error(`An exception occurred while generating a product SKU: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

module.exports = generate_product_sku;
