const bcrypt = require("bcrypt");
const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const verify_otp_for_password_change = async (req, res) => {
      const { otp, otp_oid, new_password } = req.body;
      const user_id = req.credentials.user_id;

      try {
            // 1. Reuse existing OTP validation
            const { valid, message } = await validate_otp(otp, otp_oid, user_id);

            if (!valid) {
                  return res.status(404).json({ code: 404, message });
            }

            // 2. OTP is valid → update the password
            let encrypted_pass = await bcrypt.hash(new_password, 10);
            const sql = {
                  text: `UPDATE ${TABLE.LOGIN} SET password = $1 WHERE email = $2`,
                  values: [encrypted_pass, user_id]
            }

            await execute_value(sql);

            return res.status(200).json({ code: 200, message: 'OTP verified and password updated successfully.' });

      } catch (e) {
            log.error(`Error in password change: ${e?.message}`);
            return res.status(500).json({ code: 500, message: 'Something went wrong! Please try again later.' });
      }
};



const validate_otp = async (otp, otp_oid, user_id) => {
      const sql = {
            text: `SELECT * FROM ${TABLE.OTP_LOG} WHERE oid = $1 AND user_id = $2 AND otp = $3 AND status = 'Active' AND expires_at > NOW()`,
            values: [otp_oid, user_id, otp],
      };

      try {
            const result = await get_data(sql); // assuming this returns an array of rows
            if (result && result.length > 0) {
                  // Optionally, mark OTP as used
                  await execute_value({
                        text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE oid = $1`,
                        values: [otp_oid]
                  });
                  return { valid: true, message: 'OTP is valid' };
            } else {
                  return { valid: false, message: 'OTP is invalid or expired' };
            }
      } catch (e) {
            log.error(`Error validating OTP: ${e.message}`);
            return { valid: false, message: 'Internal server error' };
      }
};


module.exports = verify_otp_for_password_change;