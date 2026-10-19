const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, fail, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// A person's own name, mobile, designation and photo. edited_on moves with it, which is what makes
// their session payload, and so the name in the header, reload on the next sign-in or tab.
const update_profile_info = async (request, res) => {
    const { name, mobile_number, designation, photo } = request.body;
    const { user_id, login_oid } = request.credentials;
    try {
        const profile = await execute_transaction(async (tx) => {
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET name = $1, mobile_number = $2, designation = $3, photo = $4, edited_by = $5, edited_on = clock_timestamp()
                        WHERE oid = $6 AND status = 'Active' RETURNING email, name, mobile_number, designation, photo`,
                values: [name, mobile_number, designation, photo, user_id, login_oid],
            });
            if (updated.rowCount !== 1) fail(404, "Your account could not be found. Sign in again.");
            await saveLogActivity({ reference_type: "user", reference_oid: login_oid, title: "Profile updated", description: `${name} updated their own profile.` }, { tx, request });
            return updated.rows[0];
        });
        log.info(`Profile updated by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Profile saved", data: profile });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        if (e?.code === "23505" && e.constraint === "login_mobile_number_unique") return res.status(409).json({ code: 409, message: "Someone else already uses this mobile number. Use another number.", data: { field: "mobile_number" } });
        log.error(`An exception occurred while updating a profile: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Your profile was not saved. Try again in a moment." });
    }
};

module.exports = update_profile_info;
