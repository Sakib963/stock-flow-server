const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("./constant");
const { get_data, execute_value } = require("./database");
const { log } = require("./log");

// Rate limiting for endpoints that no signed-in user is standing behind.
//
// Counted in the database rather than in memory because the API runs on Vercel: consecutive
// requests may land on different instances, so an in-process counter would be trivial to walk
// past and would also throttle honest users at random.

// Rows older than this are useless to every bucket and get swept opportunistically.
const MAX_WINDOW_MINUTES = 60;

/**
 * Records this request and reports whether it is allowed.
 *
 * Fails CLOSED. If the ledger cannot be read, the request is refused rather than waved through:
 * these endpoints send email and guess at passwords, so the safe answer under failure is no.
 *
 * @param {object} params
 * @param {string} params.bucket           Which limit this counts against, e.g. 'forgot-password-ip'
 * @param {string} params.identifier       IP or email being limited
 * @param {number} params.limit            Requests permitted inside the window
 * @param {number} params.window_minutes   Length of the window
 * @returns {Promise<{allowed: boolean, retry_after_seconds: number}>}
 */
const check_rate_limit = async ({ bucket, identifier, limit, window_minutes }) => {
    if (!identifier) {
        // No identifier means no way to attribute the request, which is itself suspicious.
        log.warn(`Rate limit check for ${bucket} had no identifier`);
        return { allowed: false, retry_after_seconds: window_minutes * 60 };
    }

    try {
        const rows = await get_data({
            text: `SELECT count(*)::int AS n, min(created_on) AS oldest
                   FROM ${TABLE.REQUEST_THROTTLE}
                   WHERE bucket = $1 AND identifier = $2 AND created_on > NOW() - ($3 || ' minutes')::interval`,
            values: [bucket, identifier, String(window_minutes)],
        });

        const used = rows[0]?.n ?? 0;
        if (used >= limit) {
            // Tell the caller when the oldest request in the window falls out of it.
            const oldest = rows[0]?.oldest ? new Date(rows[0].oldest) : new Date();
            const freesAt = oldest.getTime() + window_minutes * 60 * 1000;
            const retry = Math.max(1, Math.ceil((freesAt - Date.now()) / 1000));
            return { allowed: false, retry_after_seconds: retry };
        }

        await execute_value({
            text: `INSERT INTO ${TABLE.REQUEST_THROTTLE} (oid, bucket, identifier) VALUES ($1, $2, $3)`,
            values: [uuidv4(), bucket, identifier],
        });

        // Opportunistic sweep, roughly one request in fifty, so the table does not grow forever
        // without needing a scheduled job.
        if (Math.random() < 0.02) prune().catch(() => {});

        return { allowed: true, retry_after_seconds: 0 };
    } catch (e) {
        log.error(`An exception occurred while checking the rate limit: ${e?.message}`);
        return { allowed: false, retry_after_seconds: 60 };
    }
};

const prune = async () => {
    await execute_value({
        text: `DELETE FROM ${TABLE.REQUEST_THROTTLE} WHERE created_on < NOW() - ($1 || ' minutes')::interval`,
        values: [String(MAX_WINDOW_MINUTES)],
    });
};

/**
 * The caller's address, as seen through Vercel's proxy.
 *
 * `req.ip` is only trustworthy because server.js sets `trust proxy`. Without it Express reports
 * the proxy's own address and every caller would share one bucket.
 */
const client_ip = (request) => {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
        // Left-most entry is the original client; the rest are proxies it passed through.
        return forwarded.split(",")[0].trim();
    }
    return request.ip || request.socket?.remoteAddress || "";
};

module.exports = { check_rate_limit, client_ip };
