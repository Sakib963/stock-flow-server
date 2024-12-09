const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt')

const create_user = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            let encrypted_pass = await bcrypt.hash(payload.password, 10);

            // Check User
            const exiting_user_id = await check_existing_user(payload.email)
            if (exiting_user_id) {
                  log.warn(`Email already exists [${payload.email}]`);
                  return res.status(409).json({ code: 409, message: "Email Already Exists!" });
            }

            const sql = {
                  text: `INSERT INTO ${TABLE.LOGIN} (oid, name, email, mobile_number, role, designation, photo, password, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                  values: [uuidv4(), payload.name, payload.email, payload.mobile_number, payload.role, payload.designation, payload.photo, encrypted_pass, payload.status, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while creating user : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`User ${payload.email} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "User Created Successfully!",
      });
}

const check_existing_user = async (email) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.LOGIN} where email = $1`,
            values: [email]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking user count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_user