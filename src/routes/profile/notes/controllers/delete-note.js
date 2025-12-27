const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const delete_note = async (request, res) => {
      let params = request.params;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `DELETE FROM ${TABLE.USER_NOTES} 
                   WHERE oid = $1 AND created_by = $2`,
                  values: [params.oid, user_id]
            }

            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while deleting note : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Note ${params.title} deleted successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Note Deleted Successfully!",
      });
}


module.exports = delete_note