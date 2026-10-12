const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const get_profile_info = async (request, res) => {
    try {
        const [profile] = await get_data({
            text: `SELECT email, name, mobile_number, designation, photo FROM ${TABLE.LOGIN} WHERE oid = $1`,
            values: [request.credentials.login_oid],
        });
        if (!profile) return res.status(404).json({ code: 404, message: "Your account could not be found. Sign in again." });
        return res.status(200).json({ code: 200, message: "Profile", data: profile });
    } catch (e) {
        log.error(`An exception occurred while reading a profile: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load your profile. Try again in a moment." });
    }
};

module.exports = get_profile_info;
