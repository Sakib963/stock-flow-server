const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_note = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `INSERT INTO ${TABLE.USER_NOTES} 
                   (oid, title, content, created_by, created_on) 
                   VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                  values: [uuidv4(), payload.title, payload.content, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while creating note : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Note ${payload.title} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Note Created Successfully!",
      });
}


module.exports = create_note