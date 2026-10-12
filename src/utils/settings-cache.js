// -----------------------------------------------------------------------------
// Settings cache: keeps the single `settings` row in memory so it is not read on every request.
//
// Freshness follows config_version, as the permission cache does: every write to the settings row
// bumps it in its own transaction, and this cache reloads the row whenever the version it was read
// at is no longer the current one. On Vercel each instance has its own memory, so a timer or a
// local invalidate only ever refreshed the instance that took the update; the version is in the
// database, so every instance sees the change on its next request.
// -----------------------------------------------------------------------------
const { TABLE } = require("./constant");
const { get_data } = require("../db/database");
const { read_config_version } = require("./config-version");

let cache = null;
let cachedAt = null;

const loadFromDb = async () => {
    const rows = await get_data({ text: `SELECT * FROM ${TABLE.SETTINGS} ORDER BY created_on ASC LIMIT 1`, values: [] });
    return rows.length ? rows[0] : null;
};

/** The settings row, read again whenever config_version has moved since it was cached. */
const getSettings = async () => {
    const version = await read_config_version();
    if (cache && cachedAt === version) return cache;
    cache = await loadFromDb();
    cachedAt = version;
    return cache;
};

/** Drops this instance's copy at once; the version does the same for every other instance. */
const invalidateSettings = () => {
    cache = null;
    cachedAt = null;
};

module.exports = { getSettings, invalidateSettings };
