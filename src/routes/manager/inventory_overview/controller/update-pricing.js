const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

const update_pricing = async (request, res) => {
  let payload = request.body;
  let user_id = request.credentials.user_id;
  try {
    const sqlList = [];

    const inventoryUpdateSql = {
      text: `update ${TABLE.INVENTORY} set selling_price = $1, maximum_discount = $2, status = $3, edited_on = clock_timestamp(), edited_by = $4 where oid = $5`,
      values: [
        payload.selling_price,
        payload.maximum_discount,
        "ready_for_sale",
        user_id,
        payload.oid,
      ],
    };

    sqlList.push(inventoryUpdateSql);

    const hasCostProfilePayload = [
      "ad_run_cost",
      "packaging_cost",
      "gift_cost",
      "content_creation_cost",
      "influencer_cost",
      "cost_remarks",
    ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

    if (hasCostProfilePayload) {
      sqlList.push({
        text: `INSERT INTO ${TABLE.PURCHASE_DETAILS_COST_PROFILE} (oid, purchase_details_oid, ad_run_cost, packaging_cost, gift_cost, content_creation_cost, influencer_cost, cost_remarks, created_by, created_on)
                               SELECT $1, i.purchase_details_oid, $2, $3, $4, $5, $6, $7, $8, clock_timestamp()
                               FROM ${TABLE.INVENTORY} i
                               WHERE i.oid = $9
                               ON CONFLICT (purchase_details_oid)
                               DO UPDATE SET
                                     ad_run_cost = EXCLUDED.ad_run_cost,
                                     packaging_cost = EXCLUDED.packaging_cost,
                                     gift_cost = EXCLUDED.gift_cost,
                                     content_creation_cost = EXCLUDED.content_creation_cost,
                                     influencer_cost = EXCLUDED.influencer_cost,
                                     cost_remarks = EXCLUDED.cost_remarks,
                                     edited_by = EXCLUDED.created_by,
                                     edited_on = clock_timestamp()`,
        values: [
          uuidv4(),
          payload.ad_run_cost ?? null,
          payload.packaging_cost ?? null,
          payload.gift_cost ?? null,
          payload.content_creation_cost ?? null,
          payload.influencer_cost ?? null,
          payload.cost_remarks || null,
          user_id,
          payload.oid,
        ],
      });
    }

    await execute_values(sqlList);
  } catch (e) {
    log.error(`An exception occurred while updating batch : ${e?.message}`);
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }

  log.info(`Batch ${payload.oid} updated successfully by : ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Batch Updated Successfully!",
  });
};

module.exports = update_pricing;
