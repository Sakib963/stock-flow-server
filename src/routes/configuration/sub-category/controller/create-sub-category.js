const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { require_active_parent } = require("../utils/parent");
const { v4: uuidv4 } = require("uuid");

const create_sub_category = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const subCategoryOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  await require_active_parent(tx, payload.category_oid);
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.SUB_CATEGORIES} (oid, name, category_code, description, category_oid, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        values: [subCategoryOid, payload.name, payload.category_code, payload.description, payload.category_oid, payload.status, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "sub-category",
                              reference_oid: subCategoryOid,
                              title: "Created sub-category",
                              description: `Created sub-category "${payload.name}" with code ${payload.category_code}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            if (already_written(e)) {
                  log.info(`Sub-category ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Sub-Category Created Successfully!", data: { oid: subCategoryOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Sub-category not created, ${conflict.field} already taken`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating sub-category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Sub-category ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({ code: 200, message: "Sub-Category Created Successfully!", data: { oid: subCategoryOid } });
};

module.exports = create_sub_category;
