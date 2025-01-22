const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_aisle = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check aisle
            const exiting_aisle = await check_existing_aisle(payload.code)
            if (exiting_aisle) {
                  log.warn(`Name already exists [${payload.name}]`);
                  return res.status(409).json({ code: 409, message: "Name Already Exists!" });
            }

            const sql = {
                  text: `INSERT INTO ${TABLE.AISLE} (oid, name, code, warehouse_oid, capacity, type_of_storage, special_notes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                  values: [uuidv4(), payload.name, payload.code, payload.warehouse_oid, payload.capacity, payload.type_of_storage, payload.special_notes, payload.status, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while creating aisle : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Aisle ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Aisle Created Successfully!",
      });
}

const check_existing_aisle = async (code) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.AISLE} where code = $1`,
            values: [code]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking aisle count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_aisle