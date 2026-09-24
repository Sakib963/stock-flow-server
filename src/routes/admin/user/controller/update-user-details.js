const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { end_sessions_for_login, request_context } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");

const update_user_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            await execute_transaction(async (tx) => {
                  await tx.execute_value({
                        text: `update ${TABLE.LOGIN} set name = $1, mobile_number = $2, role = $3, designation = $4, photo = $5, status = $6, edited_on = clock_timestamp(), edited_by = $7 where oid = $8`,
                        values: [payload.name, payload.mobile_number, payload.role, payload.designation, payload.photo, payload.status, user_id, payload.oid]
                  });

                  // Turning an account off has to end what it already has open, not only refuse its
                  // next sign-in.
                  if (payload.status === "Inactive") {
                        const ended = await end_sessions_for_login(tx, { login_oid: payload.oid, reason: "UserDeactivated", by: user_id });
                        await record_sessions_ended(tx, ended, { login_oid: payload.oid, email: payload.email, reason: "UserDeactivated", context: request_context(request) });
                  }
            });
      } catch (e) {
            log.error(`An exception occurred while updating user : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`User ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "User Updated Successfully!",
      });
}

module.exports = update_user_details
