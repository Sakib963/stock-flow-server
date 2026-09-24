const { execute_transaction, fail } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { saveLogActivity } = require("../../../utils/activity-logger");
const { end_own_session, request_context } = require("../../../auth/auth-session");
const { record_sessions_ended } = require("../../../auth/auth-event");
const { describe_device } = require("../../../auth/user-agent");

/**
 * Signs out one of the caller's other devices, from the signed-in devices list.
 *
 * Another account's session answers 404 exactly like one that is already over, so a session id
 * guessed or copied from somewhere reveals nothing. This device's own session is refused: ending it
 * is signing out, which also clears the cookie and leaves the app, and belongs to that endpoint.
 */
const sign_out_session = async (request, res) => {
    const { login_oid, session_oid, user_id } = request.credentials;
    const { session_id } = request.body;

    if (session_id === session_oid) {
        return res.status(400).json({ code: 400, message: "That is this device. Use Sign out to leave it." });
    }

    try {
        const ended = await execute_transaction(async (tx) => {
            const row = await end_own_session(tx, { session_oid: session_id, login_oid, reason: "RemoteSignOut", by: user_id });
            if (!row) fail(404, "That device is no longer signed in.");
            await record_sessions_ended(tx, [row], { login_oid, email: user_id, reason: "RemoteSignOut", context: request_context(request) });
            return row;
        });

        const { browser, os } = describe_device(ended.user_agent);
        saveLogActivity({
            reference_type: "auth",
            reference_oid: login_oid,
            title: "Signed out a device",
            description: `Signed out ${browser && os ? `${browser} on ${os}` : "an unrecognised device"} from another device.`,
            performed_by: user_id,
        });

        log.info(`Signed out one device for ${user_id}`);
        return res.status(200).json({ code: 200, message: "Device signed out", data: { session_id } });
    } catch (e) {
        if (e?.no_retry && e?.code && e?.message) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while signing out a device: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not sign that device out. Please try again." });
    }
};

module.exports = sign_out_session;
