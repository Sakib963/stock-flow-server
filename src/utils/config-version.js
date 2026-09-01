const crypto = require("crypto");
const { TABLE } = require("./constant");
const { get_data, execute_value } = require("./database");
const { log } = require("./log");

// The boot payload (permissions, menu, business profile) is fetched on every reload but changes
// perhaps monthly. Recomputing it every time is waste, and on Vercel there is nowhere reliable to
// cache it server side: each request may hit a different instance.
//
// So the client keeps the payload and the server's job is to answer "has anything changed" as
// cheaply as possible. That answer is this one row, read by primary key.
//
// Anything that writes a role, a permission grant, a menu item or the settings row must call
// bump_config_version() in the same transaction, or clients will serve stale menus until their
// next sign-in.

/** Global stamp, one indexed read. */
const read_config_version = async () => {
    try {
        const rows = await get_data({ text: `SELECT version FROM ${TABLE.CONFIG_VERSION} LIMIT 1` });
        return rows[0]?.version ?? 0;
    } catch (e) {
        log.error(`An exception occurred while reading the config version: ${e?.message}`);
        // Returning a fresh value on failure means no 304, so the client refetches. Serving a
        // stale menu would be worse than doing the work.
        return Date.now();
    }
};

const bump_config_version = async (tx = null) => {
    const query = { text: `UPDATE ${TABLE.CONFIG_VERSION} SET version = version + 1, edited_on = CURRENT_TIMESTAMP` };
    if (tx) return tx.execute_value(query);
    return execute_value(query);
};

/**
 * The ETag for one user's boot payload.
 *
 * Global config alone is not enough: reassigning someone's role changes what they may see without
 * changing any role, menu item or setting. Folding in their own role and edit stamp covers that.
 */
const payload_etag = ({ configVersion, roleOid, userEditedOn }) => {
    const raw = `${configVersion}|${roleOid ?? "none"}|${userEditedOn ? new Date(userEditedOn).getTime() : 0}`;
    return `"${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16)}"`;
};

module.exports = { read_config_version, bump_config_version, payload_etag };
