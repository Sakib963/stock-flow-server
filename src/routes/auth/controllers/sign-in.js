const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../utils/database");
const { generate_token, refresh_token, update_login_log } = require("../../../utils/helper");
const { log } = require("../../../utils/log");
const bcrypt = require('bcrypt')

const signInUser = async (request, res) => {
      const { email, password } = request?.body;
      let user_token = { user_id: email };

      try {
            let data = await get_user_data(request);

            if (data == null) {
                  log.warn(`User not found [${request.body["email"]}] `);
                  return res.status(404).json({ code: 404, message: "User not found with this credentials." });
            }

            if (!(await bcrypt.compare(password, data.password))) {
                  log.warn(`Password did not match: User - ${email}`);
                  return res.status(404).json({ code: 404, message: "Password did not match with this credentials." });
            }

            if (data.status !== 'active') {
                  log.warn(`User is not Active: User - ${email}`);
                  return res.status(404).json({ code: 404, message: "User is not Active" });
            }

            let token = generate_token(user_token);
            let ref_token = refresh_token(user_token);

            try {
                  await update_login_log(token, ref_token)
                  log.info(`Sign in successful for user: ${email}`);

                  return res.status(200).json({
                        code: 200, message: "Sign-in successful", data: {
                              access_token: token, refresh_token: ref_token, role: data.role, email, name: data.name
                        }
                  });
            } catch (e) {
                  log.error(`An exception occurred while updating sign in log: ${e.message}`);
                  return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
            }
      } catch (e) {
            log.error(`An exception occurred while sign in: ${e.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

const get_user_data = async (request) => {
      let data = null;
      let sql = {
            text: `select l.oid, l.email, l.name, l.password, lower(l.status) as status, l.role
            from  ${TABLE.LOGIN} l 
            where 1 = 1 and l.email = $1`,
            values: [request.body.email],
      };
      try {
            let data_set = await get_data(sql);
            data = data_set.length ? data_set[0] : null;
      } catch (e) {
            log.error(
                  `An exception occurred while getting login information : ${e?.message}`
            );
      }
      return data;
};



module.exports = signInUser;