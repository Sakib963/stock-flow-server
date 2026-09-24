const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { describe_device } = require("../../../auth/user-agent");

/**
 * Every device signed in to the caller's account right now, this one first.
 *
 * A session whose refresh token has idled out is left off even though its row still says Active:
 * sessions end lazily, when next presented, and listing one that can never renew would show the
 * person a device that is not really signed in.
 *
 * Times are returned as instants. The columns are timestamps without a zone written in the
 * database's own zone, so they are placed in that zone before they leave, or a server running in
 * a different zone would shift every "last active" by the difference.
 */
const get_sessions = async (request, res) => {
    const { login_oid, session_oid } = request.credentials;

    try {
        const rows = await get_data({
            text: `SELECT s.oid, s.ip_address, s.user_agent, s.remember,
                          s.created_on AT TIME ZONE current_setting('TimeZone') AS signed_in_on,
                          s.last_used_on AT TIME ZONE current_setting('TimeZone') AS last_used_on
                   FROM ${TABLE.AUTH_SESSION} s
                   WHERE s.login_oid = $1 AND s.status = 'Active' AND s.expires_on > LOCALTIMESTAMP
                     AND EXISTS (SELECT 1 FROM ${TABLE.AUTH_REFRESH_TOKEN} t
                                 WHERE t.session_oid = s.oid AND t.status = 'Active' AND t.expires_on > LOCALTIMESTAMP)
                   ORDER BY s.last_used_on DESC`,
            values: [login_oid],
        });

        const sessions = rows
            .map((row) => ({
                id: row.oid,
                current: row.oid === session_oid,
                device: describe_device(row.user_agent),
                ip_address: row.ip_address,
                remember: row.remember,
                signed_in_on: row.signed_in_on,
                last_used_on: row.last_used_on,
            }))
            .sort((a, b) => Number(b.current) - Number(a.current));

        return res.status(200).json({ code: 200, message: "Signed-in devices found", data: sessions, total: sessions.length });
    } catch (e) {
        log.error(`An exception occurred while listing sessions: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load your signed-in devices. Please try again." });
    }
};

module.exports = get_sessions;
