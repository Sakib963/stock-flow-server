const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { taka, resolve_paid } = require("../utils/order-rules");

const LABEL = { paid: "Paid", partially_paid: "Partially paid", unpaid: "Unpaid" };

// Payment stays open after the delivery is verified: suppliers are often paid after the goods
// arrive, and an order frozen at "unpaid" stayed owed on the supplier page for good. What was
// actually agreed with the supplier is the owner's to record, never the app's to work out.
const update_purchase_payment = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [order] = await tx.get_data({
                        text: `SELECT po_number, status, total_amount::bigint AS total_amount, payment_status, paid_amount::bigint AS paid_amount FROM ${TABLE.PURCHASE} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });
                  if (!order) fail(404, "That purchase order no longer exists.");
                  if (order.status === "Cancelled") fail(409, "This order was cancelled, so its payment can no longer be changed.", { status: order.status });

                  const total = Number(order.total_amount);
                  const paid_amount = resolve_paid(payload, total);
                  if (order.payment_status === payload.payment_status && Number(order.paid_amount) === paid_amount) {
                        changed = false;
                        return;
                  }

                  await tx.execute_value({
                        text: `UPDATE ${TABLE.PURCHASE} SET payment_status = $1, paid_amount = $2, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $4 AND status <> 'Cancelled'`,
                        values: [payload.payment_status, paid_amount, user_id, payload.oid],
                  });

                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: payload.oid,
                              title: "Payment recorded",
                              description: `${order.po_number}: ${LABEL[order.payment_status] ?? "No status"} ${taka(order.paid_amount)} to ${LABEL[payload.payment_status]} ${taka(paid_amount)}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while recording payment on purchase order ${payload.oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not record the payment. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
      return res.status(200).json({ code: 200, message: "Payment recorded", data: { changed: true } });
};

module.exports = update_purchase_payment;
