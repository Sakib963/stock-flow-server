const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Guarded in the UPDATE itself, so an approval landing at the same moment cannot leave a rejected
// disposal whose stock already left. Only a Submitted one is waiting on someone's decision.
const reject_product_dispose = async (request, res) => {
      const { oid, reason } = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const rejected = await tx.execute_value({
                        text: `UPDATE ${TABLE.PRODUCT_DISPOSE}
                                  SET status = 'Rejected', reject_reason = $1, rejected_by = $2, rejected_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp()
                                WHERE oid = $3 AND status = 'Submitted'
                            RETURNING dispose_no`,
                        values: [reason, user_id, oid],
                  });
                  if (!rejected.rowCount) {
                        const [disposal] = await tx.get_data({ text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`, values: [oid] });
                        if (!disposal) fail(404, "That disposal no longer exists.");
                        fail(409, `This disposal is ${disposal.status}, so it cannot be rejected.`, { status: disposal.status });
                  }
                  await saveLogActivity({ reference_type: "product-dispose", reference_oid: oid, title: "Rejected", description: `${rejected.rows[0].dispose_no}: ${reason}` }, { tx, request });
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while rejecting disposal ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not reject the disposal. Try again in a moment." });
      }

      log.info(`Disposal ${oid} rejected by ${user_id}`);
      return res.status(200).json({ code: 200, message: "Disposal rejected" });
};

module.exports = reject_product_dispose;
