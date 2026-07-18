const { TABLE } = require("../../../../utils/constant");
const { execute_values, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

const update_product_dispose_details = async (request, res) => {
  const payload = request.body;
  const user_id = request.credentials.user_id;

  try {
    const statusData = await get_data({
      text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`,
      values: [payload.oid],
    });
    if (!statusData.length) {
      return res
        .status(404)
        .json({ code: 404, message: "Product dispose not found" });
    }
    if (statusData[0].status !== "Submitted") {
      return res.status(400).json({
        code: 400,
        message: "Only submitted disposals can be edited",
      });
    }

    const products = payload.products || [];
    if (!products.length) {
      return res.status(400).json({
        code: 400,
        message: "A disposal must contain at least one product line",
      });
    }

    // Snapshot cost_price and validate batches server-side
    const inventoryOids = [...new Set(products.map((p) => p.inventory_oid))];
    const inventoryRows = await get_data({
      text: `SELECT oid, product_oid, cost_price FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
      values: [inventoryOids],
    });
    const inventoryByOid = new Map(inventoryRows.map((row) => [row.oid, row]));

    for (const product of products) {
      const batch = inventoryByOid.get(product.inventory_oid);
      if (!batch) {
        return res.status(400).json({
          code: 400,
          message: "One or more selected batches no longer exist",
        });
      }
      if (batch.product_oid !== product.product_oid) {
        return res.status(400).json({
          code: 400,
          message: "Product/batch mismatch in dispose payload",
        });
      }
    }

    let total_dispose_quantity = 0;
    let total_dispose_value = 0;
    const insert_lines_sql = [];

    products.forEach((product) => {
      const batch = inventoryByOid.get(product.inventory_oid);
      const cost_price = Number(batch.cost_price) || 0;
      const quantity = Number(product.dispose_quantity) || 0;
      total_dispose_quantity += quantity;
      total_dispose_value += cost_price * quantity;

      insert_lines_sql.push({
        text: `INSERT INTO ${TABLE.DISPOSE_DETAILS} (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        values: [
          uuidv4(),
          payload.oid,
          product.product_oid,
          product.inventory_oid,
          quantity,
          product.reason,
          cost_price,
          product.line_note || null,
          user_id,
        ],
      });
    });

    // Replace lines: delete existing then reinsert (safe while Submitted)
    const delete_lines_sql = {
      text: `DELETE FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`,
      values: [payload.oid],
    };

    const update_header_sql = {
      text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET disposal_date = $1, disposal_method = $2, notes = $3, total_dispose_quantity = $4, total_dispose_value = $5, edited_on = clock_timestamp(), edited_by = $6 WHERE oid = $7`,
      values: [
        payload.disposal_date,
        payload.disposal_method,
        payload.notes || null,
        total_dispose_quantity,
        total_dispose_value,
        user_id,
        payload.oid,
      ],
    };

    await execute_values([
      update_header_sql,
      delete_lines_sql,
      ...insert_lines_sql,
    ]);

    saveLogActivity({
      reference_type: "product-dispose",
      reference_oid: payload.oid,
      title: "Dispose Updated",
      description: `Disposal updated with ${products.length} line item(s)`,
      performed_by: user_id,
    });
  } catch (e) {
    log.error(
      `An exception occurred while updating product dispose: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }

  log.info(`Product dispose ${payload.oid} updated successfully by: ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Product dispose Updated Successfully!",
  });
};

module.exports = update_product_dispose_details;
