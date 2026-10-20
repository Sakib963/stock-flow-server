const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context, count_live } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");
const { caller_for } = require("../utils/user-rules");

// Everyone the caller could sign out one by one: not themselves, not a vendor account unless they are
// the vendor, and nobody whose role holds access the caller does not.
const REACHABLE = `
    SELECT l.oid, l.email FROM ${TABLE.LOGIN} l LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
     WHERE l.oid <> $1 AND l.status <> 'Deleted' AND (r.scope IS DISTINCT FROM 'system' OR $2)
       AND NOT EXISTS (SELECT 1 FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
                        WHERE rp.role_oid = l.role_oid AND NOT (p.code = ANY($3::text[])))
     ORDER BY l.oid FOR UPDATE OF l`;

const sign_out_everyone = async (request, res) => {
    let people = 0;
    let devices = 0;
    try {
        const caller = await caller_for(request);
        const context = request_context(request);
        await execute_transaction(async (tx) => {
            const logins = await tx.get_data({ text: REACHABLE, values: [caller.login_oid, !!caller.system, [...caller.held]] });
            for (const login of logins) {
                const ended = await end_sessions_for_login(tx, { login_oid: login.oid, reason: "RemoteSignOut", by: caller.user_id });
                if (!ended.length) continue;
                await record_sessions_ended(tx, ended, { login_oid: login.oid, email: login.email, reason: "RemoteSignOut", context });
                people += 1;
                devices += count_live(ended);
            }
            await saveLogActivity({ reference_type: "user", reference_oid: caller.login_oid, title: "Signed everyone out", description: `${people} ${people === 1 ? "person" : "people"}, ${devices} ${devices === 1 ? "device" : "devices"}` }, { tx, request });
        });
    } catch (e) {
        log.error(`An exception occurred while signing everyone out: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not sign everyone out. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "Signed everyone out", data: { people, devices } });
};

module.exports = sign_out_everyone;
