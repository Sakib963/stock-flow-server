const { execute_transaction } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { saveLogActivity } = require("../../../utils/activity-logger");
const { end_sessions_for_login, clear_refresh_token, request_context } = require("../../../auth/auth-session");
const { record_sessions_ended } = require("../../../auth/auth-event");

/**
 * Ends every open session of the signed-in account. With `keep_current`, every one but this device,
 * which is what someone looking at a device they do not recognise usually wants: the others gone,
 * without being thrown out of the screen they are using to do it.
 */
const sign_out_everywhere = async (request, res) => {
    const { login_oid, session_oid, user_id } = request.credentials;
    const keep_current = request.body?.keep_current === true;
    const context = request_context(request);

    try {
        const sessions_closed = await execute_transaction(async (tx) => {
            const ended = await end_sessions_for_login(tx, { login_oid, reason: "SignOutEverywhere", by: user_id, except_session_oid: keep_current ? session_oid : null });
            await record_sessions_ended(tx, ended, { login_oid, email: user_id, reason: "SignOutEverywhere", context });
            return ended.length;
        });

        const devices = `${sessions_closed} open ${sessions_closed === 1 ? "session" : "sessions"}`;
        saveLogActivity({
            reference_type: "auth",
            reference_oid: login_oid,
            title: keep_current ? "Signed out other devices" : "Signed out everywhere",
            description: keep_current ? `Ended ${devices} on other devices.` : `Ended ${devices} across every device.`,
            performed_by: user_id,
        });

        if (!keep_current) clear_refresh_token(res);
        log.info(`Signed out ${keep_current ? "other devices" : "everywhere"}: ${user_id}, sessions closed: ${sessions_closed}`);
        return res.status(200).json({ code: 200, message: keep_current ? "Signed out other devices" : "Signed out on every device", data: { sessions_closed } });
    } catch (e) {
        log.error(`An exception occurred while signing out everywhere: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not sign out the other devices. Please try again." });
    }
};

module.exports = sign_out_everywhere;
