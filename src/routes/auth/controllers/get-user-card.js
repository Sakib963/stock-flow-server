const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { log } = require("../../../utils/log");

// Sign-in only, with no permission code, for the same reason as the session routes above it: the
// name is already printed in the list the caller is reading, and the card adds the designation and
// role behind it. Refusing that would tell a colleague they may not see who their own colleague is.
// It stays in auth rather than under administration, which is account administration and a
// different power.
//
// The role comes from the role table through role_oid, never login.role, which is a legacy
// free-text label nothing checks and can disagree with what the person may actually do.
//
// An address with no account answers 200 with nulls rather than 404: the row that named it is real
// and the card says the account is no longer active, which is the true answer to what was asked.
const get_user_card = async (request, res) => {
    const email = String(request.query.email ?? "").trim();
    try {
        const rows = await get_data({
            text: `SELECT l.email, l.name, l.designation, l.photo, l.status, r.name AS role
                     FROM ${TABLE.LOGIN} l
                     LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
                    WHERE LOWER(l.email) = LOWER($1)`,
            values: [email],
        });

        const person = rows[0];
        return res.status(200).json({
            code: 200,
            message: "Person",
            data: {
                email,
                name: person?.name ?? null,
                designation: person?.designation ?? null,
                role: person?.role ?? null,
                photo: person?.photo ?? null,
                active: person?.status === "Active",
            },
        });
    } catch (e) {
        log.error(`An exception occurred while reading a person card: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load this person. Try again in a moment." });
    }
};

module.exports = get_user_card;
