const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { deductFreeStock } = require("../../../sales/utils/stock-movement");
const { describe } = require("../utils/dispose-rules");
const { business_today } = require("../../../../utils/business-time");

// The status moves first, guarded, so a second approval waits on the row lock and finds it Approved.
// Only units free of holds are taken, so an order never loses stock it was promised; one line that no
// longer fits rolls every line back.
const approve_product_dispose = async (request, res) => {
      const { oid } = request.body;
      const user_id = request.credentials.user_id;

      try {
            const result = await execute_transaction(async (tx) => {
                  const moved = await tx.execute_value({
                        text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET status = 'Approved', approved_by = $1, approved_on = clock_timestamp(), disposal_date = ${business_today}, edited_by = $1, edited_on = clock_timestamp()
                                WHERE oid = $2 AND status = 'Submitted' RETURNING dispose_no`,
                        values: [user_id, oid],
                  });
                  if (!moved.rowCount) {
                        const [disposal] = await tx.get_data({ text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`, values: [oid] });
                        if (!disposal) fail(404, "That disposal no longer exists.");
                        fail(409, disposal.status === "Draft" ? "Submit this disposal before approving it." : `This disposal is already ${disposal.status}, so it cannot be approved.`, { status: disposal.status });
                  }
                  const { dispose_no } = moved.rows[0];

                  const lines = await tx.get_data({ text: `SELECT product_oid, inventory_oid, dispose_quantity::int AS quantity, reason FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1 ORDER BY created_on, oid`, values: [oid] });
                  if (!lines.length) fail(409, "This disposal has no lines. Edit it and add at least one.");

                  for (const [index, line] of lines.entries()) {
                        const taken = await deductFreeStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, reason: "disposed", source_oid: oid, user_id });
                        if (!taken) {
                              const [batch] = await tx.get_data({
                                    text: `SELECT i.batch_code, (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free
                                             FROM ${TABLE.INVENTORY} i WHERE i.oid = $1`,
                                    values: [line.inventory_oid],
                              });
                              fail(409, `Line ${index + 1}: batch ${batch.batch_code} has only ${Math.max(batch.free, 0)} free now. Edit the line and approve again.`, { line: index });
                        }
                        // The product's own figures count damage apart from other waste.
                        const column = line.reason === "damaged" || line.reason === "quality_reject" ? "total_damaged" : "total_wasted";
                        await tx.execute_value({ text: `UPDATE ${TABLE.PRODUCT_STATS} SET ${column} = ${column} + $1, last_edited_on = clock_timestamp() WHERE product_oid = $2`, values: [line.quantity, line.product_oid] });
                  }

                  await saveLogActivity({ reference_type: "product-dispose", reference_oid: oid, title: "Approved", description: describe(dispose_no, lines) }, { tx, request });
                  return { dispose_no };
            });

            log.info(`Disposal ${result.dispose_no} approved by ${user_id}`);
            return res.status(200).json({ code: 200, message: "Disposal approved", data: result });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while approving disposal ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not approve the disposal. Try again in a moment." });
      }
};

module.exports = approve_product_dispose;
