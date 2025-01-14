const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_warehouse = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check Category
            const exiting_warehouse = await check_existing_warehouse(payload.code)
            if (exiting_warehouse) {
                  log.warn(`Warehouse already exists [${payload.code}]`);
                  return res.status(409).json({ code: 409, message: "Warehouse Already Exists!" });
            }

            const sql = {
                  text: `INSERT INTO ${TABLE.WAREHOUSE} (oid, name, code, location, capacity, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  values: [uuidv4(), payload.name, payload.code, payload.location, payload.capacity, payload.status, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while creating warehouse : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Warehouse ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Warehouse Created Successfully!",
      });
}

const check_existing_warehouse = async (code) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.WAREHOUSE} where code = $1`,
            values: [code]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking warehouse count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_warehouse