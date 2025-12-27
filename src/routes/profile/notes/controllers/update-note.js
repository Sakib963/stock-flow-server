const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_note = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `UPDATE ${TABLE.USER_NOTES} 
                   SET title = $1, content = $2, edited_by = $3, edited_on = CURRENT_TIMESTAMP 
                   WHERE oid = $4 AND created_by = $5`,
                  values: [payload.title, payload.content, user_id, payload.oid, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating note : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Note ${payload.title} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Note Updated Successfully!",
      });
}


module.exports = update_note