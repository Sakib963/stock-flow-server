const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { require_active_warehouse } = require("../utils/parent");
const { v4: uuidv4 } = require("uuid");

const create_aisle = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const aisleOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  await require_active_warehouse(tx, payload.warehouse_oid);
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.AISLE} (oid, name, code, warehouse_oid, storage_type, capacity_units, special_notes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        values: [aisleOid, payload.name, payload.code, payload.warehouse_oid, payload.storage_type, payload.capacity_units, payload.special_notes, payload.status, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "aisle",
                              reference_oid: aisleOid,
                              title: "Created aisle",
                              description: `Created aisle "${payload.name}" with code ${payload.code}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            if (already_written(e)) {
                  log.info(`Aisle ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Aisle Created Successfully!", data: { oid: aisleOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Aisle not created, ${conflict.field} already taken`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating aisle : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Aisle ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({ code: 200, message: "Aisle Created Successfully!", data: { oid: aisleOid } });
};

module.exports = create_aisle;
