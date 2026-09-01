const { TABLE } = require("./constant");
const { get_data } = require("./database");
const { log } = require("./log");
const { read_config_version } = require("./config-version");

// Route level authorisation.
//
// Until this existed, `login.role` was a label nothing checked: any signed-in user could call any
// endpoint, including creating users. jwtMiddleware answers "who are you"; this answers "may you".
// Both are needed, and the frontend hiding a button is neither.
//
// Usage, always after jwtMiddleware:
//   router.post(ROUTES.CREATE_USER, [jwtMiddleware, requirePermission('administration.user.create'), validator...], handler)

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map();

const permissions_for = async (user_id) => {
    const version = await read_config_version();
    const key = `${user_id}|${version}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.codes;

    const rows = await get_data({
        text: `SELECT p.code
               FROM ${TABLE.LOGIN} l
               JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid AND r.status = 'Active'
               JOIN ${TABLE.ROLE_PERMISSION} rp ON rp.role_oid = r.oid
               JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
               WHERE l.email = $1 AND l.status = 'Active'`,
        values: [user_id],
    });

    const codes = new Set(rows.map((r) => r.code));
    cache.set(key, { codes, expires: Date.now() + CACHE_TTL_MS });
    if (cache.size > 500) cache.clear();
    return codes;
};

/**
 * @param {string} code Permission required, e.g. 'inventory.purchase-order.approve'
 */
const requirePermission = (code) => async (request, res, next) => {
    try {
        const user_id = request?.credentials?.user_id;
        if (!user_id) {
            // requirePermission placed before jwtMiddleware, which is a wiring mistake rather than
            // a rejected user. Fail closed and make it loud.
            log.error(`requirePermission('${code}') ran with no credentials. Check middleware order.`);
            return res.status(401).json({ code: 401, message: "Unauthorized" });
        }

        const held = await permissions_for(user_id);
        if (held.has(code)) return next();

        // 403 and not 404: the caller is authenticated, the route exists, and they may not use it.
        // Distinct from the 401 jwtMiddleware returns for no or expired token, because the client
        // signs out on a 401 and signing someone out for a button they should not have seen is
        // both confusing and wrong.
        log.warn(`Permission denied: ${user_id} lacks ${code}`);
        return res.status(403).json({ code: 403, message: "You do not have permission to do that." });
    } catch (e) {
        log.error(`An exception occurred while checking permission ${code}: ${e?.message}`);
        // Fail closed. An authorisation check that cannot run is a denial, never an allowance.
        return res.status(403).json({ code: 403, message: "You do not have permission to do that." });
    }
};

module.exports = requirePermission;
