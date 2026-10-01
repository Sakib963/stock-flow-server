const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Guarded in the UPDATE itself, so a verify landing at the same moment cannot leave a rejected
// adjustment whose stock already moved. Only a Submitted one is waiting on someone's decision.
const reject_stock_adjustment = async (request, res) => {
      const { oid, reason } = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const rejected = await tx.execute_value({
                        text: `UPDATE ${TABLE.STOCK_ADJUSTMENT}
                                  SET status = 'Rejected', reject_reason = $1, rejected_by = $2, rejected_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp()
                                WHERE oid = $3 AND status = 'Submitted'
                            RETURNING adjustment_number`,
                        values: [reason, user_id, oid],
                  });
                  if (!rejected.rowCount) {
                        const [adjustment] = await tx.get_data({ text: `SELECT status FROM ${TABLE.STOCK_ADJUSTMENT} WHERE oid = $1`, values: [oid] });
                        if (!adjustment) fail(404, "That adjustment no longer exists.");
                        fail(409, `This adjustment is ${adjustment.status}, so it cannot be rejected.`, { status: adjustment.status });
                  }
                  await saveLogActivity({ reference_type: "stock-adjustment", reference_oid: oid, title: "Rejected", description: `${rejected.rows[0].adjustment_number}: ${reason}` }, { tx, request });
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while rejecting stock adjustment ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not reject the adjustment. Try again in a moment." });
      }

      log.info(`Stock adjustment ${oid} rejected by ${user_id}`);
      return res.status(200).json({ code: 200, message: "Adjustment rejected" });
};

module.exports = reject_stock_adjustment;
