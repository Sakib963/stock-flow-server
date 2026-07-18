const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

const stats_column_for_reason = (reason) => {
  const damaged = new Set(["damaged", "breakage"]);
  return damaged.has(reason) ? "total_damaged" : "total_wasted";
};

const reverse_product_dispose = async (request, res) => {
  const user_id = request.credentials.user_id;
  const dispose_oid = request.body.oid;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Transition Approved -> Reversed (guarded)
    const headerResult = await client.query({
      text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET status = $1, reversed_by = $2, reversed_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND status = $4 RETURNING dispose_no`,
      values: ["Reversed", user_id, dispose_oid, "Approved"],
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
        message: "Only approved disposals can be reversed",
      });
    }

    const dispose_no = headerResult.rows[0].dispose_no;

    const lines = await client.query({
      text: `SELECT product_oid, inventory_oid, dispose_quantity, reason FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`,
      values: [dispose_oid],
    });

    for (const line of lines.rows) {
      // Restore the previously deducted stock
      await client.query({
        text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available + $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
        values: [line.dispose_quantity, user_id, line.inventory_oid],
      });

      // Roll back the product-level counter that approval incremented
      await client.query({
        text: `UPDATE ${TABLE.PRODUCT_STATS} SET ${stats_column_for_reason(line.reason)} = GREATEST(${stats_column_for_reason(line.reason)} - $1, 0), last_edited_on = current_timestamp WHERE product_oid = $2`,
        values: [line.dispose_quantity, line.product_oid],
      });
    }

    await client.query("COMMIT");

    saveLogActivity({
      reference_type: "product-dispose",
      reference_oid: dispose_oid,
      title: "Dispose Reversed",
      description: `Disposal ${dispose_no} reversed; stock restored for ${lines.rowCount} batch(es)`,
      performed_by: user_id,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error(
        `An exception occurred while rolling back reverse dispose: ${rollbackError?.message}`,
      );
    }
    log.error(
      `An exception occurred while reversing product dispose: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  } finally {
    client.release();
  }

  log.info(`Product dispose ${dispose_oid} reversed by: ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Product dispose reversed successfully!",
  });
};

module.exports = reverse_product_dispose;
