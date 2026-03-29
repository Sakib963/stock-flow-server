const { TABLE } = require("../../../../utils/constant");
const { execute_values, get_data } = require("../../../../utils/database");
const {
  generate_batch_code,
} = require("../../../../utils/generate-batch-code");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

const verify_purchase_order = async (request, res) => {
  const payload = request.body;
  const user_id = request.credentials.user_id;

  try {
    const statusSql = {
      text: `SELECT status FROM ${TABLE.PURCHASE} WHERE oid = $1`,
      values: [payload.oid],
    };

    const statusData = await get_data(statusSql);
    if (!statusData.length) {
      return res
        .status(404)
        .json({ code: 404, message: "Purchase order not found" });
    }

    if (statusData[0].status !== "Submitted") {
      return res.status(400).json({
        code: 400,
        message: "Only submitted purchase orders can be verified",
      });
    }

    const purchase_sql = {
      text: `UPDATE ${TABLE.PURCHASE} SET status = $1, verified_on = clock_timestamp(), verified_by = $2, edited_on = clock_timestamp(), edited_by = $2 WHERE oid = $3`,
      values: ["Verified", user_id, payload.oid],
    };

    let batch_code;
    let is_unique = false;
    while (!is_unique) {
      batch_code = generate_batch_code();
      is_unique = await check_unique_batch_code(batch_code);
    }

    const purchase_details_sql = [];
    const inventory_insert_sql = [];
    const purchase_details_cost_profile_sql = [];

    payload.products.forEach((product) => {
      purchase_details_sql.push({
        text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET verified_quantity = $1, verified_unit_price = $2 WHERE oid = $3 AND purchase_oid = $4`,
        values: [
          product.verified_quantity,
          product.verified_unit_price,
          product.oid,
          payload.oid,
        ],
      });

      let status = "internal_use";
      if (product.intended_use === "for_sale" && product.selling_price) {
        status = "ready_for_sale";
      } else if (
        product.intended_use === "for_sale" &&
        !product.selling_price
      ) {
        status = "pending_pricing";
      }

      inventory_insert_sql.push({
        text: `INSERT INTO ${TABLE.INVENTORY} (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, intended_use, status, created_by, selling_price, maximum_discount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        values: [
          uuidv4(),
          batch_code,
          product.product_oid,
          product.oid,
          product.verified_quantity,
          product.verified_quantity,
          product.verified_unit_price,
          product.intended_use,
          status,
          user_id,
          product.selling_price,
          product.maximum_discount,
        ],
      });

      const hasCostProfile =
        product.ad_run_cost !== undefined ||
        product.packaging_cost !== undefined ||
        product.gift_cost !== undefined ||
        product.content_creation_cost !== undefined ||
        product.influencer_cost !== undefined ||
        (product.cost_remarks && `${product.cost_remarks}`.trim().length > 0);

      if (hasCostProfile) {
        purchase_details_cost_profile_sql.push({
          text: `INSERT INTO ${TABLE.PURCHASE_DETAILS_COST_PROFILE} (oid, purchase_details_oid, ad_run_cost, packaging_cost, gift_cost, content_creation_cost, influencer_cost, cost_remarks, created_by, created_on)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
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
            product.oid,
            product.ad_run_cost ?? null,
            product.packaging_cost ?? null,
            product.gift_cost ?? null,
            product.content_creation_cost ?? null,
            product.influencer_cost ?? null,
            product.cost_remarks || null,
            user_id,
          ],
        });
      }
    });

    await execute_values([
      purchase_sql,
      ...purchase_details_sql,
      ...purchase_details_cost_profile_sql,
      ...inventory_insert_sql,
    ]);

    saveLogActivity({
      reference_type: "purchase-order",
      reference_oid: payload.oid,
      title: "Purchase Order Verified",
      description: `Purchase order verified and inventory moved to batch ${batch_code}`,
      performed_by: user_id,
    });
  } catch (e) {
    log.error(
      `An exception occurred while verifying purchase order: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }

  log.info(
    `Purchase order ${payload.oid} verified successfully by: ${user_id}`,
  );
  return res.status(200).json({
    code: 200,
    message: "Purchase order verified Successfully!",
  });
};

const check_unique_batch_code = async (batch_code) => {
  const sql = {
    text: `SELECT COUNT(oid)::int4 as total FROM ${TABLE.INVENTORY} WHERE batch_code = $1`,
    values: [batch_code],
  };

  try {
    const data_set = await get_data(sql);
    return data_set[0].total === 0;
  } catch (e) {
    log.error(
      `An exception occurred while checking batch code uniqueness: ${e?.message}`,
    );
    throw new Error(e);
  }
};

module.exports = verify_purchase_order;
