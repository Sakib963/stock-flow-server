const { get_data } = require("../../../db/database");
const { permissions_for } = require("../../../middleware/require-permission");
const { business_today } = require("../../../utils/business-time");

// A spreadsheet holds this many rows; past it the totals would describe rows nobody received, so the
// report is refused instead (docs/report REQ-21).
const ROW_LIMIT = 50000;

// With no first day, the month of the last day (today when neither is given), as sales analytics.
const PERIOD_SQL = `
    SELECT to_char(COALESCE($1::date, date_trunc('month', COALESCE($2::date, ${business_today}))::date), 'YYYY-MM-DD') AS date_from,
           to_char(COALESCE($2::date, ${business_today}), 'YYYY-MM-DD') AS date_to`;

const read_period = async (date_from, date_to) => (await get_data({ text: PERIOD_SQL, values: [date_from ?? null, date_to ?? null] }))[0];

const DAY_MS = 24 * 60 * 60 * 1000;

const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

/**
 * Runs one report for the caller: the period, the channels they sell through, and the cost columns
 * only when they may see buying prices (REQ-02). Cost values are taken out of the rows and totals,
 * not only hidden, so they never leave the server.
 */
const run_report = async (definition, request) => {
    const held = await permissions_for(request.credentials.user_id);
    const money = held.has("inventory.stock-value.view");
    if (definition.requires && !held.has(definition.requires)) return { forbidden: true };
    // A person's sales figures cover the channels they sell through, as every order page (sales REQ-02).
    const held_channels = [held.has("sales.pos.view") && "POS", held.has("sales.online.view") && "ONLINE"].filter(Boolean);
    const channels = request.query.channel ? held_channels.filter((c) => c === request.query.channel) : held_channels;

    const period = definition.period ? await read_period(request.query.date_from, request.query.date_to) : null;
    // A first day alone runs to today, which the schema cannot see, so the length is checked here too.
    if (period && (new Date(period.date_to) - new Date(period.date_from)) / DAY_MS > 366) return { too_long: true, period };
    const rows = await definition.read({ query: request.query, period, channels, limit: ROW_LIMIT + 1 });
    if (rows.length > ROW_LIMIT) return { too_many: true, period };

    const totals = definition.totals ? definition.totals(rows) : Object.fromEntries(definition.columns.filter((c) => c.total).map((c) => [c.key, sum(rows, c.key)]));
    // A column can also need its own permission, such as a saved address someone selling only at the counter may not see.
    const hidden = new Set([...(money ? [] : [...definition.columns.filter((c) => c.cost).map((c) => c.key), ...(definition.cost_totals ?? [])]), ...definition.columns.filter((c) => c.requires && !held.has(c.requires)).map((c) => c.key)]);
    const columns = definition.columns.filter((c) => !hidden.has(c.key));
    const pick = (row) => Object.fromEntries(columns.map((c) => [c.key, row[c.key] ?? null]));

    return {
        title: definition.title,
        period,
        columns: columns.map(({ key, label, type, total }) => ({ key, label, type, total: !!total })),
        totals: Object.fromEntries(Object.entries(totals).filter(([key]) => !hidden.has(key))),
        rows: rows.map(pick),
        note: definition.note ?? null,
    };
};

module.exports = { run_report, sum, ROW_LIMIT };
