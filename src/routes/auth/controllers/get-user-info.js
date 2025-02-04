const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../utils/database");
const { log } = require("../../../utils/log");

const get_user_info = async (request, res) => {
      let data = null;
      let sql = {
            text: `select name, email, mobile_number, role, status, photo, designation from ${TABLE.LOGIN} r where email = $1`,
            values: [request.credentials.user_id],
      };
      try {
            let data_set = await get_data(sql);
            data = data_set.length !== 1 ? null : data_set[0];

            log.info(`User info Found: ${data?.email}`)
            return res.status(200).json({
                  code: 200, message: "User info Found", data
            });
      } catch (e) {
            log.error(`An exception occurred while getting user information : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = get_user_info