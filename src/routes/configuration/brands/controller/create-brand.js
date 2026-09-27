const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { v4: uuidv4 } = require('uuid');

const create_brand = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const brandOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.BRANDS} (oid, name, description, origin_country, status, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
                        values: [brandOid, payload.name, payload.description, payload.origin_country, payload.status, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "brand",
                              reference_oid: brandOid,
                              title: "Created brand",
                              description: `Created brand "${payload.name}"`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (already_written(e)) {
                  log.info(`Brand ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Brand Created Successfully!", data: { oid: brandOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Brand not created, ${conflict.field} already taken by another brand`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating brand : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Brand ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Brand Created Successfully!",
            data: { oid: brandOid },
      });
}

module.exports = create_brand
