const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { request_where } = require("../utils/request-where");
const { SIGNALS } = require("../utils/signals");

const get_signals = async (request, res) => {
    try {
        const { where, values } = request_where(request.query);
        const signals = await Promise.all(SIGNALS.map(async ({ key, threshold, window, sql }) => ({ key, threshold, window: window ?? null, matches: await get_data({ text: sql(where, Number(threshold)), values }) })));
        return res.status(200).json({ code: 200, message: "Signals", data: { signals } });
    } catch (e) {
        log.error(`An exception occurred while reading the signals: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the security signals. Try again in a moment." });
    }
};

module.exports = get_signals;
