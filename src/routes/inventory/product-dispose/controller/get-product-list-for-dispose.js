const { get_data } = require("../../../../db/database");
const { escape_like } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { PRODUCTS_SQL, without_cost } = require("../../utils/batch-picker");
const { sees_money } = require("../../utils/sees-money");

const get_product_list_for_dispose = async (request, res) => {
      const term = typeof request.query.search === "string" ? request.query.search.trim() : "";
      try {
            const [rows, money] = await Promise.all([get_data({ text: PRODUCTS_SQL, values: [term ? `%${escape_like(term)}%` : null, request.query.limit] }), sees_money(request)]);
            const shown = money ? rows : rows.map(without_cost);
            return res.status(200).json({ code: 200, message: "Products", data: shown });
      } catch (e) {
            log.error(`An exception occurred while searching products for a disposal: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not search products. Try again in a moment." });
      }
};

module.exports = get_product_list_for_dispose;
