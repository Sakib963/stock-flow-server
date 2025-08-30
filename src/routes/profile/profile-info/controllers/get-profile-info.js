const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_profile_info = async (request, res) => {
      const user_id = request.credentials.user_id;

      try {
            const sql = {
                  text: `SELECT oid, email, name, mobile_number, designation, photo, role FROM ${TABLE.LOGIN} WHERE email = $1`,
                  values: [user_id]
            }

            const data_set = await get_data(sql);
            const data = data_set[0] ?? null;

            if (data) {
                  log.info(`Profile Info retrieved successfully for user: ${request.credentials.user_id}`);

                  return res.status(200).json({
                        code: 200, message: "Profile Info details found", data
                  });
            }

            log.info(`No Profile Info details found for user: ${request.credentials.user_id}`);
            return res.status(404).json({ code: 404, message: "Profile Info details not found" });
      } catch (e) {
            log.error(`An exception occurred while getting profile details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = get_profile_info;