const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Map a per-line reason code to the product_stats counter it feeds.
const stats_column_for_reason = (reason) => {
  const damaged = new Set(["damaged", "breakage"]);
  return damaged.has(reason) ? "total_damaged" : "total_wasted";
};

const approve_product_dispose = async (request, res) => {
  const user_id = request.credentials.user_id;
  const dispose_oid = request.body.oid;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Transition Submitted -> Approved (guarded)
    const headerResult = await client.query({
      text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET status = $1, approved_by = $2, approved_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND status = $4 RETURNING dispose_no`,
      values: ["Approved", user_id, dispose_oid, "Submitted"],
    });

    if (!headerResult.rowCount) {
      const statusCheck = await client.query({
        text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`,
        values: [dispose_oid],
      });
      await client.query("ROLLBACK");
      if (!statusCheck.rowCount) {
        return res
          .status(404)
          .json({ code: 404, message: "Product dispose not found" });
      }
      return res.status(409).json({
        code: 409,
        message:
          "Disposal already processed. Only submitted disposals can be approved",
      });
    }

    const dispose_no = headerResult.rows[0].dispose_no;

    const lines = await client.query({
      text: `SELECT product_oid, inventory_oid, dispose_quantity, reason FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`,
      values: [dispose_oid],
    });

    if (!lines.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        code: 400,
        message: "Disposal has no line items to approve",
      });
    }

    for (const line of lines.rows) {
      // Deduct stock with an over-dispose guard: only succeeds if enough remains
      const stockResult = await client.query({
        text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available - $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND quantity_available >= $1`,
        values: [line.dispose_quantity, user_id, line.inventory_oid],
      });

      if (stockResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          code: 409,
          message:
            "Insufficient stock for one or more batches. Nothing was disposed.",
        });
      }

      // Feed product-level dispose analytics (best-effort within the txn)
      await client.query({
        text: `UPDATE ${TABLE.PRODUCT_STATS} SET ${stats_column_for_reason(line.reason)} = ${stats_column_for_reason(line.reason)} + $1, last_edited_on = current_timestamp WHERE product_oid = $2`,
        values: [line.dispose_quantity, line.product_oid],
      });
    }

    await client.query("COMMIT");

    saveLogActivity({
      reference_type: "product-dispose",
      reference_oid: dispose_oid,
      title: "Dispose Approved",
      description: `Disposal ${dispose_no} approved; stock deducted for ${lines.rowCount} batch(es)`,
      performed_by: user_id,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error(
        `An exception occurred while rolling back approve dispose: ${rollbackError?.message}`,
      );
    }
    log.error(
      `An exception occurred while approving product dispose: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  } finally {
    client.release();
  }

  log.info(`Product dispose ${dispose_oid} approved by: ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Product dispose approved successfully!",
  });
};

module.exports = approve_product_dispose;
