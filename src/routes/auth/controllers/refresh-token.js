const { get_data, execute_value } = require("../../../utils/database");
const jwt = require("jsonwebtoken");
const { log } = require("../../../utils/log");
const { generate_token, update_login_log } = require("../../../utils/helper");
const { TABLE } = require("../../../utils/constant");

const refresh_token = async (request, res) => {
      const { refresh_token } = request?.body;
      let new_token = null;

      try {
            let data = await get_data_by_refresh_token(refresh_token);
            if (!data) {
                  log.warn(`Refresh token is not in database [${request.body.refresh_token}]`);
                  return res.status(404).json({ code: 404, message: "Refresh token is not in database!" });
            }
            let decoded = {};
            try {
                  decoded = jwt.verify(refresh_token, process.env.REFRESH_TOKEN_SECRET);
            } catch (err) {
                  await delete_expire_token(refresh_token);
                  return res.status(404).json({ code: 404, message: "Refresh token was expired. Please make a new sign in request!" });
            }

            let token = { user_id: decoded.token.user_id };
            new_token = generate_token(token);
            await update_login_log(new_token, refresh_token);
            log.info(`New token generated using refresh token [${token['user_id']}]`);

            return res.status(200).json({
                  code: 200, message: "Generated Refresh Token", data: {
                        access_token: new_token, refresh_token: refresh_token
                  }
            });
      } catch (e) {
            log.error(`An exception occurred while getting refresh token : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Internal server error. Please Try again later!" });
      }
}


const get_data_by_refresh_token = async (refresh_token) => {
      let data = null;
      let sql = {
            text: `select oid, lower(status) as status, refresh_token
              from ${TABLE.LOGIN_LOG} 
              where 1 = 1 and refresh_token = $1`,
            values: [refresh_token],
      };
      try {
            let data_set = await get_data(sql);
            data = data_set.length ? data_set[0] : null;
      } catch (e) {
            log.error(`An exception occurred while getting login log : ${e?.message}`);
      }
      return data;
};


const delete_expire_token = async (refresh_token) => {
      let sql = {
            text: `delete from ${TABLE.LOGIN_LOG}  where 1=1 and refresh_token = $1`,
            values: [refresh_token]
      };
      try {
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating login log : ${e?.message}`);
      }
};

module.exports = refresh_token;