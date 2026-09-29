const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { taka, order_total, resolve_paid, draft_paid, check_references, insert_lines } = require("../utils/order-rules");
const { v4: uuidv4 } = require("uuid");

const GONE = "That purchase order no longer exists.";

const line_key = (line) => [line.product_oid, line.warehouse_oid ?? "", line.aisle_oid ?? "", line.quantity === null ? "" : Number(line.quantity), line.unit_price === null ? "" : Number(line.unit_price)].join("|");

const products_summary = (count, total) => `${count} product${count === 1 ? "" : "s"}, total ${taka(total)}`;

// Lines are replaced wholesale: nothing points at a line until the order is verified, and only a Draft
// or a Submitted order can be edited, so an edit that removes a line or swaps its product is safe.
//
// A Draft saved again stays a Draft; saved with draft false it is submitted, with every check a new
// order gets. A Submitted order saved again is resubmitted and stays Submitted: it cannot go back to
// a Draft, and its payment changes only through Record payment, so an edit opened before a payment
// was recorded cannot put the old one back.
const update_purchase_order_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;
      let status;

      try {
            await execute_transaction(async (tx) => {
                  const [order] = await tx.get_data({
                        text: `SELECT po_number, status, supplier_oid, purchase_type, to_char(expected_delivery_date, 'YYYY-MM-DD') AS expected_delivery_date, special_notes, payment_status, paid_amount::bigint AS paid_amount
                               FROM ${TABLE.PURCHASE} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });
                  if (!order) fail(404, GONE);
                  if (order.status !== "Draft" && order.status !== "Submitted") fail(409, `This order is ${order.status} and can no longer be edited.`, { status: order.status });

                  const was_draft = order.status === "Draft";
                  if (!was_draft && payload.draft) fail(409, "A submitted order cannot go back to a draft.", { status: order.status });
                  if (!was_draft && (payload.payment_status || payload.paid_amount !== undefined)) fail(400, "Payment on a submitted order changes through Record payment.", { field: "payment_status" });
                  if (was_draft && !payload.draft && !payload.payment_status) fail(400, "Choose the payment status before submitting.", { field: "payment_status" });

                  await check_references(tx, payload);

                  const total_amount = order_total(payload.products);
                  status = was_draft && !payload.draft ? "Submitted" : order.status;
                  const payment = was_draft ? { payment_status: payload.payment_status, paid_amount: payload.paid_amount ?? 0 } : { payment_status: order.payment_status, paid_amount: Number(order.paid_amount) };
                  const paid_amount = status === "Draft" ? draft_paid(payment, total_amount) : resolve_paid(payment, total_amount);

                  const lines = await tx.get_data({
                        text: `SELECT product_oid, warehouse_oid, aisle_oid, ordered_quantity AS quantity, ordered_unit_price AS unit_price FROM ${TABLE.PURCHASE_DETAILS} WHERE purchase_oid = $1`,
                        values: [payload.oid],
                  });

                  const header_changes = [
                        ["supplier", order.supplier_oid !== payload.supplier_oid],
                        ["purchase type", (order.purchase_type ?? null) !== payload.purchase_type],
                        ["expected delivery", order.expected_delivery_date !== payload.expected_delivery_date],
                        ["notes", (order.special_notes ?? null) !== payload.special_notes],
                        ["payment", was_draft && ((order.payment_status ?? null) !== (payment.payment_status ?? null) || Number(order.paid_amount) !== paid_amount)],
                  ]
                        .filter(([, differs]) => differs)
                        .map(([label]) => label);
                  const lines_changed = lines.map(line_key).sort().join(",") !== payload.products.map(line_key).sort().join(",");

                  if (!header_changes.length && !lines_changed && status === order.status) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.PURCHASE}
                                  SET supplier_oid = $1, purchase_type = $2, expected_delivery_date = $3, special_notes = $4, payment_status = $5, paid_amount = $6, total_amount = $7, status = $8,
                                      edited_by = $9, edited_on = clock_timestamp()
                                WHERE oid = $10 AND status = $11`,
                        values: [payload.supplier_oid, payload.purchase_type, payload.expected_delivery_date, payload.special_notes, payment.payment_status, paid_amount, total_amount, status, user_id, payload.oid, order.status],
                  });
                  if (updated.rowCount !== 1) fail(409, "This order changed while you were editing it. Reload it and try again.");

                  if (lines_changed) {
                        await tx.execute_value({ text: `DELETE FROM ${TABLE.PURCHASE_DETAILS} WHERE purchase_oid = $1`, values: [payload.oid] });
                        await insert_lines(tx, payload.oid, payload.products, uuidv4);
                  }

                  const what = [...header_changes, ...(lines_changed ? [`products (${products_summary(payload.products.length, total_amount)})`] : [])];
                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: payload.oid,
                              title: was_draft ? (status === "Submitted" ? "Submitted" : "Draft saved") : "Edited and resubmitted",
                              description: what.length ? `${order.po_number}: changed ${what.join(", ")}` : `${order.po_number}: ${products_summary(payload.products.length, total_amount)}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while updating purchase order ${payload.oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the purchase order. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false, status } });

      log.info(`Purchase order ${payload.oid} saved as ${status} by ${user_id}`);
      return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Purchase order saved", data: { changed: true, status } });
};

module.exports = update_purchase_order_details;
