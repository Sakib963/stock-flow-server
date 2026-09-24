const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { v4: uuidv4 } = require('uuid');

const create_category = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const categoryOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.CATEGORIES} (oid, name, category_code, description, status, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
                        values: [categoryOid, payload.name, payload.category_code, payload.description, payload.status, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "category",
                              reference_oid: categoryOid,
                              title: "Created category",
                              description: `Created category "${payload.name}" with code ${payload.category_code}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            // A retry of a write that already succeeded. Answering 500 here told the person their
            // category was not saved, and their second attempt then collided with the row they
            // could not see.
            if (already_written(e)) {
                  log.info(`Category ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Category Created Successfully!", data: { oid: categoryOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Category not created, ${conflict.field} already taken by another category`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Category ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Category Created Successfully!",
            data: { oid: categoryOid },
      });
}

module.exports = create_category
