const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_supplier = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check Category
            const exiting_supplier = await check_existing_supplier(payload.name)
            if (exiting_supplier) {
                  log.warn(`Supplier already exists [${payload.name}]`);
                  return res.status(409).json({ code: 409, message: "Name Already Exists!" });
            }

            const sql = {
                  text: `INSERT INTO ${TABLE.SUPPLIER} (oid, name, contact_person, phone_number, email, address, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                  values: [uuidv4(), payload.name, payload.contact_person, payload.phone_number, payload.email, payload.address, payload.status, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while creating supplier : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Supplier ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Supplier Created Successfully!",
      });
}

const check_existing_supplier = async (name) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.SUPPLIER} where name = $1`,
            values: [name]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking supplier count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_supplier