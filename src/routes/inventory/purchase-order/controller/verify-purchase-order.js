const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { get_data } = require("../../../../utils/database");
const {
  generate_batch_code,
} = require("../../../../utils/generate-batch-code");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

const verify_purchase_order = async (request, res) => {
  const payload = request.body;
  const user_id = request.credentials.user_id;
  const client = await pool.connect();

  try {
    if (!Array.isArray(payload.products) || !payload.products.length) {
      return res.status(400).json({
        code: 400,
        message: "At least one product is required for verification",
      });
    }

    await client.query("BEGIN");

    const detailsResult = await client.query({
      text: `SELECT oid, product_oid FROM ${TABLE.PURCHASE_DETAILS} WHERE purchase_oid = $1`,
      values: [payload.oid],
    });

    if (!detailsResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        code: 404,
        message: "Purchase order not found",
      });
    }

    const payloadDetailOids = payload.products.map((product) => product.oid);
    const uniquePayloadDetailOids = new Set(payloadDetailOids);
    if (uniquePayloadDetailOids.size !== payloadDetailOids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        code: 400,
        message: "Duplicate product rows found in verification payload",
      });
    }

    if (payload.products.length !== detailsResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        code: 400,
        message: "Verification payload must include all purchase items",
      });
    }

    const dbDetailsByOid = new Map(
      detailsResult.rows.map((row) => [row.oid, row]),
    );
    for (const product of payload.products) {
      const detailRow = dbDetailsByOid.get(product.oid);
      if (!detailRow) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          code: 400,
          message: "Invalid purchase item found in verification payload",
        });
      }

      if (detailRow.product_oid !== product.product_oid) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          code: 400,
          message: "Product identity mismatch in verification payload",
        });
      }
    }

    const purchase_sql = {
      text: `UPDATE ${TABLE.PURCHASE} SET status = $1, verified_on = clock_timestamp(), verified_by = $2, edited_on = clock_timestamp(), edited_by = $2 WHERE oid = $3 AND status = $4 RETURNING oid`,
      values: ["Verified", user_id, payload.oid, "Submitted"],
    };

    const purchaseUpdateResult = await client.query(purchase_sql);
    if (!purchaseUpdateResult.rowCount) {
      const statusCheck = await client.query({
        text: `SELECT status FROM ${TABLE.PURCHASE} WHERE oid = $1`,
        values: [payload.oid],
      });

      await client.query("ROLLBACK");

      if (!statusCheck.rowCount) {
        return res
          .status(404)
          .json({ code: 404, message: "Purchase order not found" });
      }

      return res.status(409).json({
        code: 409,
        message:
          "Purchase order already processed. Only submitted orders can be verified",
      });
    }

    let batch_code;
    let is_unique = false;
    while (!is_unique) {
      batch_code = generate_batch_code();
      is_unique = await check_unique_batch_code(batch_code, client);
    }

    for (const product of payload.products) {
      const updateDetailsResult = await client.query({
        text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET verified_quantity = $1, verified_unit_price = $2 WHERE oid = $3 AND purchase_oid = $4`,
        values: [
          product.verified_quantity,
          product.verified_unit_price,
          product.oid,
          payload.oid,
        ],
      });

      if (updateDetailsResult.rowCount !== 1) {
        throw new Error(
          `Unable to update purchase details for oid ${product.oid}`,
        );
      }

      let status = "internal_use";
      const hasSellingPrice =
        product.selling_price !== null && product.selling_price !== undefined;
      if (product.intended_use === "for_sale" && hasSellingPrice) {
        status = "ready_for_sale";
      } else if (product.intended_use === "for_sale" && !hasSellingPrice) {
        status = "pending_pricing";
      }

      await client.query({
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

      const hasNumericCost = [
        product.ad_run_cost,
        product.packaging_cost,
        product.gift_cost,
        product.content_creation_cost,
        product.influencer_cost,
      ].some((value) => value !== null && value !== undefined);

      const hasRemark = !!(
        product.cost_remarks && `${product.cost_remarks}`.trim().length > 0
      );

      const hasCostProfile = hasNumericCost || hasRemark;

      if (hasCostProfile) {
        await client.query({
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
    }

    await client.query("COMMIT");

    saveLogActivity({
      reference_type: "purchase-order",
      reference_oid: payload.oid,
      title: "Purchase Order Verified",
      description: `Purchase order verified and inventory moved to batch ${batch_code}`,
      performed_by: user_id,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error(
        `An exception occurred while rolling back verify purchase order: ${rollbackError?.message}`,
      );
    }

    if (e?.code === "23505") {
      return res.status(409).json({
        code: 409,
        message:
          "Purchase order already verified or inventory already created for one or more items",
      });
    }

    log.error(
      `An exception occurred while verifying purchase order: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  } finally {
    client.release();
  }

  log.info(
    `Purchase order ${payload.oid} verified successfully by: ${user_id}`,
  );
  return res.status(200).json({
    code: 200,
    message: "Purchase order verified Successfully!",
  });
};

const check_unique_batch_code = async (batch_code, client = null) => {
  try {
    const sql = {
      text: `SELECT COUNT(oid)::int4 as total FROM ${TABLE.INVENTORY} WHERE batch_code = $1`,
      values: [batch_code],
    };

    const queryClient = client || {
      query: (query) => get_data(query).then((rows) => ({ rows })),
    };
    const data_set = await queryClient.query(sql);
    const rows = data_set.rows || data_set;
    return rows[0].total === 0;
  } catch (e) {
    log.error(
      `An exception occurred while checking batch code uniqueness: ${e?.message}`,
    );
    throw new Error(e);
  }
};

module.exports = verify_purchase_order;
