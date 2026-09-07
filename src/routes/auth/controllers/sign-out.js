const { TABLE } = require("../../../utils/constant");
const { execute_value } = require("../../../utils/database");
const { log } = require("../../../utils/log");

/**
 * Ends the session in the database, not only in the browser.
 *
 * Signing out used to be a localStorage delete and nothing else, so the access token stayed good
 * for the rest of its 30 minutes and the refresh token for another 7 days. A copy taken from a
 * shared counter machine outlived the person who signed out, and the database had no way to know.
 * Closing the row is what makes validate-jwt reject the access token and refresh-token refuse to
 * mint a new one.
 *
 * Both tokens of the session are closed together, because a refresh rotates the access token on a
 * row that keeps its refresh token, and a person signing out means all of it.
 *
 * The tokens carried by the request are what authorises it. There is no jwtMiddleware, because the
 * access token has usually expired by the time someone signs out and the session still has to end.
 *
 * The answer is 200 whatever the update touched. A token that is already closed, expired or
 * unknown means the session is over, which is exactly what the caller asked for, and an error here
 * would only strand someone on a screen they are trying to leave.
 */
const sign_out = async (request, res) => {
    const authorizationHeader = request.headers["authorization"] || "";
    const access_token = authorizationHeader.replace("Bearer ", "").trim();
    const refresh_token = request.body?.refresh_token || null;

    try {
        const result = await execute_value({
            text: `update ${TABLE.LOGIN_LOG}
                   set status = 'Signout', signout_time = clock_timestamp()
                   where status = 'Signin' and (access_token = $1 or ($2::varchar is not null and refresh_token = $2))`,
            values: [access_token, refresh_token],
        });

        log.info(`Sign out request handled, sessions closed: ${result?.rowCount ?? 0}`);
        return res.status(200).json({ code: 200, message: "Signed out", data: { sessions_closed: result?.rowCount ?? 0 } });
    } catch (e) {
        log.error(`An exception occurred while signing out: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not end the session. Please try again." });
    }
};

module.exports = sign_out;
