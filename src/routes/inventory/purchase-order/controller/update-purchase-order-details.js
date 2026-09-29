const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { taka, order_total, resolve_paid, check_references, insert_lines } = require("../utils/order-rules");
const { v4: uuidv4 } = require("uuid");

const GONE = "That purchase order no longer exists.";

const line_key = (line) => [line.product_oid, line.warehouse_oid, line.aisle_oid ?? "", Number(line.quantity), Number(line.unit_price)].join("|");

// Lines are replaced wholesale: nothing points at a line until the order is verified, and only a
// Submitted order can be edited, so an edit that removes a line or swaps its product is safe.
const update_purchase_order_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [order] = await tx.get_data({
                        text: `SELECT po_number, status, supplier_oid, purchase_type, to_char(expected_delivery_date, 'YYYY-MM-DD') AS expected_delivery_date, special_notes, payment_status, paid_amount::int AS paid_amount
                               FROM ${TABLE.PURCHASE} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });
                  if (!order) fail(404, GONE);
                  if (order.status !== "Submitted") fail(409, `This order is ${order.status} and can no longer be edited.`, { status: order.status });

                  await check_references(tx, payload);

                  const total_amount = order_total(payload.products);
                  // Payment is never written from the edit form: it has its own endpoint that stays open, and
                  // an edit loaded before a payment was recorded would put the old payment back. The stored
                  // status is kept and its amount follows the new total, the way paid means the whole total.
                  const paid_amount = resolve_paid(order, total_amount);

                  const lines = await tx.get_data({
                        text: `SELECT product_oid, warehouse_oid, aisle_oid, ordered_quantity AS quantity, ordered_unit_price AS unit_price FROM ${TABLE.PURCHASE_DETAILS} WHERE purchase_oid = $1`,
                        values: [payload.oid],
                  });

                  const header_changes = [
                        ["supplier", order.supplier_oid !== payload.supplier_oid],
                        ["purchase type", order.purchase_type !== payload.purchase_type],
                        ["expected delivery", order.expected_delivery_date !== payload.expected_delivery_date],
                        ["notes", (order.special_notes ?? null) !== payload.special_notes],
                  ]
                        .filter(([, differs]) => differs)
                        .map(([label]) => label);
                  const lines_changed = lines.map(line_key).sort().join(",") !== payload.products.map(line_key).sort().join(",");

                  if (!header_changes.length && !lines_changed) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.PURCHASE}
                                  SET supplier_oid = $1, purchase_type = $2, expected_delivery_date = $3, special_notes = $4, paid_amount = $5, total_amount = $6,
                                      edited_by = $7, edited_on = clock_timestamp()
                                WHERE oid = $8 AND status = 'Submitted'`,
                        values: [payload.supplier_oid, payload.purchase_type, payload.expected_delivery_date, payload.special_notes, paid_amount, total_amount, user_id, payload.oid],
                  });
                  if (updated.rowCount !== 1) fail(409, "This order changed while you were editing it. Reload it and try again.");

                  if (lines_changed) {
                        await tx.execute_value({ text: `DELETE FROM ${TABLE.PURCHASE_DETAILS} WHERE purchase_oid = $1`, values: [payload.oid] });
                        await insert_lines(tx, payload.oid, payload.products, uuidv4);
                  }

                  const what = [...header_changes, ...(lines_changed ? [`products (${payload.products.length} line${payload.products.length === 1 ? "" : "s"}, total ${taka(total_amount)})`] : [])];
                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: payload.oid,
                              title: "Edited",
                              description: `${order.po_number}: changed ${what.join(", ")}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while updating purchase order ${payload.oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the purchase order. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Purchase order ${payload.oid} updated by ${user_id}`);
      return res.status(200).json({ code: 200, message: "Purchase order saved", data: { changed: true } });
};

module.exports = update_purchase_order_details;
