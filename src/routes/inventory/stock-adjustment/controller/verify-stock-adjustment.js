const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { next_batch_code } = require("../../utils/batch-code");
const { openBatch, deductFreeStock, restockStock, refuseDeletedProduct } = require("../../../sales/utils/stock-movement");
const { REASON_LABEL } = require("../utils/adjustment-rules");
const { v4: uuidv4 } = require("uuid");

// The status moves first, guarded, so a second verify (a double click, a second manager) waits on the
// row lock and then finds it already Verified. Every line is applied in the same transaction, so a
// line that no longer fits (its units sold since it was submitted) rolls the whole adjustment back.
const verify_stock_adjustment = async (request, res) => {
      const { oid } = request.body;
      const user_id = request.credentials.user_id;

      try {
            const result = await execute_transaction(async (tx) => {
                  const moved = await tx.execute_value({
                        text: `UPDATE ${TABLE.STOCK_ADJUSTMENT} SET status = 'Verified', verified_by = $1, verified_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                                WHERE oid = $2 AND status = 'Submitted' RETURNING adjustment_number, reason`,
                        values: [user_id, oid],
                  });
                  if (!moved.rowCount) {
                        const [adjustment] = await tx.get_data({ text: `SELECT status FROM ${TABLE.STOCK_ADJUSTMENT} WHERE oid = $1`, values: [oid] });
                        if (!adjustment) fail(404, "That adjustment no longer exists.");
                        fail(409, adjustment.status === "Draft" ? "Submit this adjustment before verifying it." : `This adjustment is already ${adjustment.status}, so it cannot be verified.`, { status: adjustment.status });
                  }
                  const { adjustment_number, reason } = moved.rows[0];
                  const movement = reason === "opening_stock" ? "opening_stock" : "adjusted";

                  const lines = await tx.get_data({
                        text: `SELECT l.oid, l.product_oid, l.direction, l.quantity, l.inventory_oid, l.cost_price, l.intended_use, l.selling_price, l.maximum_discount,
                                      l.warehouse_oid, l.aisle_oid, l.expiry_date, p.has_expiry
                                 FROM ${TABLE.STOCK_ADJUSTMENT_LINE} l JOIN ${TABLE.PRODUCT} p ON p.oid = l.product_oid
                                WHERE l.adjustment_oid = $1 ORDER BY l.created_on, l.oid`,
                        values: [oid],
                  });
                  if (!lines.length) fail(409, "This adjustment has no lines. Edit it and add at least one.");

                  let units_in = 0;
                  let units_out = 0;
                  for (const [index, line] of lines.entries()) {
                        if (line.direction === "out") {
                              const taken = await deductFreeStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, reason: movement, source_oid: oid, user_id });
                              if (!taken) {
                                    const [batch] = await tx.get_data({
                                          text: `SELECT i.batch_code, (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free
                                                   FROM ${TABLE.INVENTORY} i WHERE i.oid = $1`,
                                          values: [line.inventory_oid],
                                    });
                                    fail(409, `Line ${index + 1}: batch ${batch.batch_code} has only ${Math.max(batch.free, 0)} free now. Edit the line and verify again.`, { line: index });
                              }
                              units_out += line.quantity;
                              continue;
                        }

                        if (line.inventory_oid) {
                              await restockStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, reason: movement, source_oid: oid, user_id });
                        } else {
                              const for_sale = line.intended_use === "for_sale";
                              const batch_oid = uuidv4();
                              await tx.execute_value({
                                    text: `INSERT INTO ${TABLE.INVENTORY} (oid, batch_code, product_oid, purchase_details_oid, stock_adjustment_line_oid, initial_quantity, quantity_available, cost_price, intended_use, status, selling_price, maximum_discount, expiry_date, warehouse_oid, aisle_oid, created_by)
                                           VALUES ($1, $2, $3, NULL, $14, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                                    values: [batch_oid, await next_batch_code(tx), line.product_oid, line.quantity, line.cost_price, line.intended_use, for_sale ? "ready_for_sale" : "internal_use", for_sale ? line.selling_price : null, for_sale ? (line.maximum_discount ?? 0) : null, line.has_expiry ? line.expiry_date : null, line.warehouse_oid, line.aisle_oid, user_id, line.oid],
                              });
                              await refuseDeletedProduct(tx, batch_oid);
                              await openBatch(tx, { inventory_oid: batch_oid, quantity: line.quantity, reason: movement, source_oid: oid, user_id });
                              await tx.execute_value({ text: `UPDATE ${TABLE.STOCK_ADJUSTMENT_LINE} SET inventory_oid = $1 WHERE oid = $2`, values: [batch_oid, line.oid] });
                        }
                        units_in += line.quantity;
                  }

                  await saveLogActivity(
                        {
                              reference_type: "stock-adjustment",
                              reference_oid: oid,
                              title: "Verified",
                              description: `${adjustment_number}: ${REASON_LABEL[reason]}, ${units_in} units in, ${units_out} units out`,
                        },
                        { tx, request }
                  );
                  return { adjustment_number, units_in, units_out };
            });

            log.info(`Stock adjustment ${result.adjustment_number} verified by ${user_id}: ${result.units_in} in, ${result.units_out} out`);
            return res.status(200).json({ code: 200, message: "Adjustment verified and stock changed", data: result });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while verifying stock adjustment ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not verify the adjustment. No stock was changed. Try again in a moment." });
      }
};

module.exports = verify_stock_adjustment;
