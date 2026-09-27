const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");

const GONE = "That supplier no longer exists. It may have been removed.";

const update_supplier_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, contact_person, phone_number, whatsapp_number, email, address, payment_details, status FROM ${TABLE.SUPPLIER} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, GONE);

                  // Saving an untouched form writes nothing, so the timeline records only real changes.
                  const changes = detectChanges(rows[0], payload);
                  if (!changes.length) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.SUPPLIER} SET name = $1, contact_person = $2, phone_number = $3, whatsapp_number = $4, email = $5, address = $6, payment_details = $7, status = $8, edited_on = clock_timestamp(), edited_by = $9 WHERE oid = $10`,
                        values: [payload.name, payload.contact_person, payload.phone_number, payload.whatsapp_number, payload.email, payload.address, payload.payment_details, payload.status, user_id, payload.oid],
                  });

                  if (updated.rowCount !== 1) fail(404, GONE);

                  await saveLogActivity(
                        {
                              reference_type: "supplier",
                              reference_oid: payload.oid,
                              title: "Updated supplier",
                              description: generateChangeDescription(`supplier "${payload.name}"`, changes),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Supplier not updated, ${conflict.field} already taken by another supplier`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating supplier : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Supplier ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Supplier Updated Successfully!",
      });
}

module.exports = update_supplier_details
