// -----------------------------------------------------------------------------
// Settings cache: keeps the single `settings` row in memory so we do not hit the
// DB on every request (settings change rarely). Freshness comes from prime/invalidate
// on UPDATE -- that is the real mechanism. The cache is long-lived otherwise.
//
// NOTE on serverless: each server instance has its own memory, so prime/invalidate
// only refreshes THIS instance. The long TTL below is just a cross-instance backstop
// so a warm instance that never handled the update still refreshes eventually.
// -----------------------------------------------------------------------------
const { TABLE } = require("./constant");
const { get_data } = require("./database");

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (backstop only; updates prime/invalidate)

let cache = null;
let cachedAt = 0;

const loadFromDb = async () => {
    const rows = await get_data({ text: `SELECT * FROM ${TABLE.SETTINGS} ORDER BY created_on ASC LIMIT 1`, values: [] });
    return rows.length ? rows[0] : null;
};

// Return settings from cache; reload from DB when empty or past its TTL.
const getSettings = async () => {
    const now = Date.now();
    if (cache && now - cachedAt < TTL_MS) return cache;
    cache = await loadFromDb();
    cachedAt = Date.now();
    return cache;
};

// Overwrite the cache with a freshly-updated row (called right after an update).
const primeSettings = (row) => {
    cache = row || null;
    cachedAt = Date.now();
};

const invalidateSettings = () => {
    cache = null;
    cachedAt = 0;
};

module.exports = { getSettings, primeSettings, invalidateSettings };
