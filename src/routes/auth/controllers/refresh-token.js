const { get_data, execute_value } = require("../../../utils/database");
const jwt = require("jsonwebtoken");
const { log } = require("../../../utils/log");
const { generate_token, rotate_access_token } = require("../../../utils/helper");
const { TABLE } = require("../../../utils/constant");

const refresh_token = async (request, res) => {
      const { refresh_token } = request?.body;
      let new_token = null;

      try {
            let data = await get_data_by_refresh_token(refresh_token);
            if (!data) {
                  log.warn(`Refresh token is not in database`);
                  return res.status(404).json({ code: 404, message: "Refresh token is not in database!" });
            }

            // A session that was signed out keeps its row, so this is where revocation bites: the
            // refresh token is still cryptographically valid for the rest of its 7 days, and it
            // must still be refused. Without this check, signing out would only inconvenience
            // whoever holds a stolen copy for 30 minutes.
            if (data.status !== 'signin') {
                  log.warn(`Refresh attempted on a session that was signed out`);
                  return res.status(401).json({ code: 401, message: "This session was signed out. Please sign in again." });
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

            // Rotating in place rather than inserting keeps one session to one row, which is what
            // makes sign-out able to close all of it, and stops the table growing a row every time
            // an access token expires.
            const rotated = await rotate_access_token(new_token, refresh_token);
            if (!rotated?.rowCount) {
                  log.warn(`Refresh token no longer belongs to an open session`);
                  return res.status(401).json({ code: 401, message: "This session was signed out. Please sign in again." });
            }
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