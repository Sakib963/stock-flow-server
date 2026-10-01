const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Guarded in the UPDATE itself: checking the status first and then writing would let a verify land in
// between, leaving a cancelled adjustment whose stock moved.
const cancel_stock_adjustment = async (request, res) => {
      const { oid, reason } = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const cancelled = await tx.execute_value({
                        text: `UPDATE ${TABLE.STOCK_ADJUSTMENT}
                                  SET status = 'Cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp()
                                WHERE oid = $3 AND status IN ('Draft', 'Submitted')
                            RETURNING adjustment_number`,
                        values: [reason, user_id, oid],
                  });
                  if (!cancelled.rowCount) {
                        const [adjustment] = await tx.get_data({ text: `SELECT status FROM ${TABLE.STOCK_ADJUSTMENT} WHERE oid = $1`, values: [oid] });
                        if (!adjustment) fail(404, "That adjustment no longer exists.");
                        fail(409, `This adjustment is already ${adjustment.status}, so it cannot be cancelled.`, { status: adjustment.status });
                  }
                  await saveLogActivity({ reference_type: "stock-adjustment", reference_oid: oid, title: "Cancelled", description: `${cancelled.rows[0].adjustment_number}: ${reason}` }, { tx, request });
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while cancelling stock adjustment ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not cancel the adjustment. Try again in a moment." });
      }

      log.info(`Stock adjustment ${oid} cancelled by ${user_id}`);
      return res.status(200).json({ code: 200, message: "Adjustment cancelled" });
};

module.exports = cancel_stock_adjustment;
