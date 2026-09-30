const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// A date missed or typed wrong at verify is fixed here, without reopening the order (decided by the
// user, 2026-09-30). The date labels the batch; what the shelf holds is unchanged, so no stock
// movement is written.
const update_batch_expiry = async (request, res) => {
      const { inventory_oid, expiry_date } = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [batch] = await tx.get_data({
                        text: `SELECT i.batch_code, to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry_date, p.name AS product_name, p.has_expiry, pu.oid AS purchase_oid, pu.po_number
                                 FROM ${TABLE.INVENTORY} i
                                 JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                                 JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = i.purchase_details_oid
                                 JOIN ${TABLE.PURCHASE} pu ON pu.oid = d.purchase_oid
                                WHERE i.oid = $1
                                  FOR UPDATE OF i`,
                        values: [inventory_oid],
                  });
                  if (!batch) fail(404, "That batch no longer exists.");
                  // Clearing is always allowed, so a product switched off can still lose a date it no longer needs.
                  if (!batch.has_expiry && expiry_date !== null) fail(409, `${batch.product_name} is not marked as a product that expires. Turn on "Has an expiry date" on the product first.`, { reason: "no_expiry" });
                  if (batch.expiry_date === expiry_date) {
                        changed = false;
                        return;
                  }

                  await tx.execute_value({
                        text: `UPDATE ${TABLE.INVENTORY} SET expiry_date = $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                        values: [expiry_date, user_id, inventory_oid],
                  });

                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: batch.purchase_oid,
                              title: "Expiry date changed",
                              description: `${batch.po_number}, ${batch.product_name} batch ${batch.batch_code}: ${batch.expiry_date ?? "no date"} to ${expiry_date ?? "no date"}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while changing the expiry date of batch ${inventory_oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the expiry date. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
      return res.status(200).json({ code: 200, message: "Expiry date saved", data: { changed: true, expiry_date } });
};

module.exports = update_batch_expiry;
