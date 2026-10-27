const { TABLE } = require("../../../../utils/constant");
const { read_choices } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Picking offers active brands only; naming by oids takes any, so a product keeps showing its brand.
const get_brand_list_for_dropdown = async (request, res) => {
      try {
            const data = await read_choices({
                  select: "b.oid AS value, b.name AS label",
                  from: `${TABLE.BRANDS} b`,
                  key: "b.oid",
                  where: request.query.oids ? [] : ["b.status = 'Active'"],
                  search: ["b.name"],
                  order: "b.name",
                  query: request.query,
            });
            return res.status(200).json({ code: 200, message: "Brands", data });
      } catch (e) {
            log.error(`An exception occurred while loading brands for a dropdown: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load brands. Try again in a moment." });
      }
};

module.exports = get_brand_list_for_dropdown;
