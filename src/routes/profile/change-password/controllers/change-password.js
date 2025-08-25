const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { save_generated_otp } = require("../../../../utils/helper");
const { log } = require("../../../../utils/log");
const bcrypt = require('bcrypt');
const send_email = require("../../../../utils/send-email");

const fs = require('fs');
const path = require('path');

const change_password = async (request, res) => {
      const payload = request.body;
      try {
            const { isValid, user_name } = await check_current_password(request.credentials.user_id, payload.current_password);
            if (!isValid) {
                  return res.status(404).json({ code: 404, message: "Current password is incorrect." });
            }

            let { otp_oid, otp } = await save_generated_otp(request.credentials.user_id);
            if (!otp_oid) {
                  return res.status(500).json({ code: 500, message: "Failed to generate OTP." });
            }

            await send_otp(request, otp, user_name);
            log.info(`OTP Send successful for user: ${request.credentials.user_id}`);

            return res.status(200).json({
                  code: 200, message: "OTP sent successfully", data: {
                        otp_oid
                  }
            });
      } catch (e) {
            log.error(`An exception occurred while getting user information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

const check_current_password = async (user_id, current_password) => {
      let isValid = false;
      let user_name;
      const sql = {
            text: `SELECT l.password, l.name FROM ${TABLE.LOGIN} l where l.email = $1`,
            values: [user_id]
      }

      try {
            const data_set = await get_data(sql);
            const encrypted_password = data_set[0]?.password;
            user_name = data_set[0]?.name;
            if (!encrypted_password) {
                  log.warn(`User not found or password missing: User - ${user_id}`);
                  return false;
            }
            if (!(await bcrypt.compare(current_password, encrypted_password))) {
                  log.warn(`Password did not match: User - ${user_id}`);
                  return false;
            }
            isValid = true;
      } catch (e) {
            log.error(`An exception occurred while getting user password information: ${e?.message}`);
      }

      return { isValid, user_name };
};

const send_otp = async (request, otp, user_name) => {
      // Read the template file
      const templatePath = path.join(__dirname, 'otp_template.html');
      let html = fs.readFileSync(templatePath, 'utf8');

      // Replace placeholders
      html = html.replace('{{OTP}}', otp);
      html = html.replace('{{YEAR}}', new Date().getFullYear());
      html = html.replace('{{USER_NAME}}', user_name);
      html = html.replace('{{CURRENT_DATE}}', new Date().toLocaleDateString('en-GB'));

      const options = {
            to: request.credentials.user_id,
            subject: 'OTP Verification - StockFlow',
            html
      };

      try {
            await send_email(options);
      } catch (e) {
            log.error(`An exception occurred while sending OTP email: ${e?.message}`);
            throw new Error("Failed to send OTP email");
      }
}

module.exports = change_password;