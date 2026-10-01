const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { next_batch_code } = require("../../utils/batch-code");
const { receiveStock } = require("../../../sales/utils/stock-movement");
const { v4: uuidv4 } = require("uuid");
const { has_budget, save_budget } = require("../../utils/cost-budget");

// The delivery is counted by hand and this is the one place stock comes in. The status moves first,
// guarded, so a second verify of the same order (a double click, a retried request, a second tab)
// waits on the row lock and then finds it already Verified: the old unguarded verify ran three times
// on one order and put three batches on the shelf for every line.
//
// The unit price here is the final one: what was agreed with the supplier at delivery, which can
// differ from the price ordered. It becomes the batch's cost.
const verify_purchase_order = async (request, res) => {
      const { oid, lines } = request.body;
      const user_id = request.credentials.user_id;

      try {
            const result = await execute_transaction(async (tx) => {
                  const moved = await tx.execute_value({
                        text: `UPDATE ${TABLE.PURCHASE} SET status = 'Verified', verified_by = $1, verified_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                                WHERE oid = $2 AND status = 'Submitted' RETURNING po_number`,
                        values: [user_id, oid],
                  });
                  if (!moved.rowCount) {
                        const [order] = await tx.get_data({ text: `SELECT status FROM ${TABLE.PURCHASE} WHERE oid = $1`, values: [oid] });
                        if (!order) fail(404, "That purchase order no longer exists.");
                        fail(409, `This order is already ${order.status}, so it cannot be verified again.`, { status: order.status });
                  }
                  const po_number = moved.rows[0].po_number;

                  const ordered = await tx.get_data({
                        text: `SELECT d.oid, d.product_oid, d.ordered_quantity::int AS ordered_quantity, d.warehouse_oid, d.aisle_oid, p.has_expiry
                                 FROM ${TABLE.PURCHASE_DETAILS} d JOIN ${TABLE.PRODUCT} p ON p.oid = d.product_oid WHERE d.purchase_oid = $1`,
                        values: [oid],
                  });
                  const by_oid = new Map(ordered.map((line) => [line.oid, line]));
                  const sent = new Set(lines.map((line) => line.oid));
                  if (sent.size !== lines.length || lines.length !== ordered.length || lines.some((line) => !by_oid.has(line.oid))) {
                        fail(400, "Every line on the order must be checked exactly once. Reload the order and check each line.");
                  }

                  let units = 0;
                  let batches = 0;
                  for (const line of lines) {
                        const { product_oid, ordered_quantity, warehouse_oid, aisle_oid, has_expiry } = by_oid.get(line.oid);
                        if (line.received_quantity > ordered_quantity) {
                              fail(400, `More arrived than was ordered on one line (${line.received_quantity} of ${ordered_quantity}). Record what was ordered and set the extra aside, or raise a new order for it.`, { line: line.oid });
                        }

                        await tx.execute_value({
                              text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET verified_quantity = $1, verified_unit_price = $2 WHERE oid = $3 AND purchase_oid = $4`,
                              values: [line.received_quantity, line.unit_price, line.oid, oid],
                        });

                        // Nothing arrived on this line, so there is no batch: an empty batch is a row every
                        // stock list has to step around.
                        if (!line.received_quantity) continue;

                        const for_sale = line.intended_use === "for_sale";
                        const batch_oid = uuidv4();
                        await tx.execute_value({
                              text: `INSERT INTO ${TABLE.INVENTORY} (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, intended_use, status, selling_price, maximum_discount, expiry_date, created_by, warehouse_oid, aisle_oid)
                                     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                              values: [batch_oid, await next_batch_code(tx), product_oid, line.oid, line.received_quantity, line.unit_price, line.intended_use, for_sale ? "ready_for_sale" : "internal_use", for_sale ? line.selling_price : null, for_sale ? line.maximum_discount : null, has_expiry ? line.expiry_date : null, user_id, warehouse_oid, aisle_oid],
                        });
                        await receiveStock(tx, { inventory_oid: batch_oid, quantity: line.received_quantity, purchase_oid: oid, user_id });
                        units += line.received_quantity;
                        batches += 1;

                        if (has_budget(line)) await save_budget(tx, { owner: "purchase_details_oid", owner_oid: line.oid, values: line, user_id });
                  }

                  const ordered_units = ordered.reduce((sum, line) => sum + line.ordered_quantity, 0);
                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: oid,
                              title: "Delivery verified",
                              description: `${po_number}: ${units} of ${ordered_units} units received, ${batches} batch${batches === 1 ? "" : "es"} created`,
                        },
                        { tx, request }
                  );

                  return { po_number, units, batches };
            });

            log.info(`Purchase order ${result.po_number} verified by ${user_id}: ${result.units} units in ${result.batches} batches`);
            return res.status(200).json({ code: 200, message: "Delivery verified and stock added", data: result });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while verifying purchase order ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not verify the delivery. Nothing was added to stock. Try again in a moment." });
      }
};

module.exports = verify_purchase_order;
