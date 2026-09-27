const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { v4: uuidv4 } = require('uuid');

const create_supplier = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const supplierOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.SUPPLIER} (oid, name, contact_person, phone_number, whatsapp_number, email, address, payment_details, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                        values: [supplierOid, payload.name, payload.contact_person, payload.phone_number, payload.whatsapp_number, payload.email, payload.address, payload.payment_details, payload.status, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "supplier",
                              reference_oid: supplierOid,
                              title: "Created supplier",
                              description: `Created supplier "${payload.name}" with phone number ${payload.phone_number}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (already_written(e)) {
                  log.info(`Supplier ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Supplier Created Successfully!", data: { oid: supplierOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Supplier not created, ${conflict.field} already taken by another supplier`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating supplier : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Supplier ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Supplier Created Successfully!",
            data: { oid: supplierOid },
      });
}

module.exports = create_supplier
