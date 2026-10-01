const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { getSettings } = require("../../../../utils/settings-cache");
const { without_money } = require("../utils/stock-figures");
const { sees_money } = require("../../utils/sees-money");
const { PRODUCT_SQL, FIGURES_SQL, BATCHES_SQL } = require("../utils/product-stock-sql");

const get_product_stock = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[product], [figures], batches, activity, money, settings] = await Promise.all([
                  get_data({ text: PRODUCT_SQL, values: [oid] }),
                  get_data({ text: FIGURES_SQL, values: [oid] }),
                  get_data({ text: BATCHES_SQL, values: [oid] }),
                  getLogActivities("product-stock", oid, 10),
                  sees_money(request),
                  getSettings(),
            ]);
            if (!product) return res.status(404).json({ code: 404, message: "That product no longer exists. It may have been deleted." });

            const shown = batches.map(({ purchase_details_oid, ...batch }) => (money ? batch : without_money(batch)));
            return res.status(200).json({
                  code: 200,
                  message: "Product stock",
                  data: {
                        product,
                        figures: money ? figures : without_money(figures),
                        batches: shown,
                        // A budget change names a cost, so it is someone else's to read.
                        activity: activity.filter((a) => money || a.title !== "Budget changed").map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                        sees_money: money,
                        // Printed on every sticker.
                        business_name: settings?.name ?? null,
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while loading the stock of product ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load this product's stock. Try again in a moment." });
      }
};

module.exports = get_product_stock;
