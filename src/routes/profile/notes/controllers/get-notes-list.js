const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_note_list = async (request, res) => {
      const user_id = request.credentials.user_id;

      try {
            const sql = {
                  text: `SELECT oid, title, content, created_on, edited_on 
                   FROM ${TABLE.USER_NOTES} 
                   WHERE created_by = $1 
                   ORDER BY created_on DESC`,
                  values: [user_id]
            }

            const data_set = await get_data(sql);
            const data = data_set ?? [];

            if (data) {
                  log.info(`Note list retrieved successfully for user: ${request.credentials.user_id} `);

                  return res.status(200).json({
                        code: 200, message: "Note list found", data
                  });
            }

            log.info(`No Note list found for user: ${request.credentials.user_id} `);
            return res.status(404).json({ code: 404, message: "Note list not found" });
      } catch (e) {
            log.error(`An exception occurred while getting note list: ${e?.message} `);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = get_note_list;