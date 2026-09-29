const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Guarded in the UPDATE itself: checking the status first and then writing let a verify land in
// between, leaving a cancelled order with stock on the shelves.
const cancel_purchase_order = async (request, res) => {
      const { oid, reason } = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const cancelled = await tx.execute_value({
                        text: `UPDATE ${TABLE.PURCHASE}
                                  SET status = 'Cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp()
                                WHERE oid = $3 AND status IN ('Draft', 'Submitted')
                            RETURNING po_number`,
                        values: [reason, user_id, oid],
                  });

                  if (!cancelled.rowCount) {
                        const [order] = await tx.get_data({ text: `SELECT status FROM ${TABLE.PURCHASE} WHERE oid = $1`, values: [oid] });
                        if (!order) fail(404, "That purchase order no longer exists.");
                        fail(409, `This order is already ${order.status}, so it cannot be cancelled.`, { status: order.status });
                  }

                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: oid,
                              title: "Cancelled",
                              description: `${cancelled.rows[0].po_number}: ${reason}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while cancelling purchase order ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not cancel the purchase order. Try again in a moment." });
      }

      log.info(`Purchase order ${oid} cancelled by ${user_id}`);
      return res.status(200).json({ code: 200, message: "Purchase order cancelled" });
};

module.exports = cancel_purchase_order;
