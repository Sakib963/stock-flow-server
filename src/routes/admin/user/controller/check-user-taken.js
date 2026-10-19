const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Answers while the form is filled, so a taken email or phone is said under its field before Save.
// The save checks again: this is only a courtesy.
const check_user_taken = async (request, res) => {
    const { email, mobile_number, oid = null } = request.query;
    try {
        const [row] = await get_data({
            text: `SELECT EXISTS (SELECT 1 FROM ${TABLE.LOGIN} WHERE $1::text IS NOT NULL AND lower(trim(email)) = lower(trim($1)) AND oid IS DISTINCT FROM $3) AS email,
                          EXISTS (SELECT 1 FROM ${TABLE.LOGIN} WHERE $2::text IS NOT NULL AND mobile_number = $2 AND status <> 'Deleted' AND oid IS DISTINCT FROM $3) AS mobile_number`,
            values: [email ?? null, mobile_number ?? null, oid],
        });
        return res.status(200).json({ code: 200, message: "Checked", data: row });
    } catch (e) {
        log.error(`An exception occurred while checking a user's email or phone: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not check the email and phone. Save will check them again." });
    }
};

module.exports = check_user_taken;
