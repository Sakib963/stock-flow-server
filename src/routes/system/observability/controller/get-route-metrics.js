const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { FROM, request_where } = require("../utils/request-where");

// Grouped by the route template, so every record's own address counts as one route.
const get_route_metrics = async (request, res) => {
    try {
        const { where, values } = request_where(request.query);
        const rows = await get_data({
            text: `SELECT r.method, r.route, COUNT(*)::int AS calls, ROUND(AVG(r.duration_ms))::int AS average_ms,
                          percentile_disc(0.95) WITHIN GROUP (ORDER BY r.duration_ms)::int AS p95_ms, MAX(r.duration_ms)::int AS slowest_ms,
                          COUNT(*) FILTER (WHERE r.status >= 500)::float / NULLIF(COUNT(*), 0) AS error_rate,
                          COUNT(*) FILTER (WHERE r.status BETWEEN 400 AND 499)::int AS client_errors
                     FROM ${FROM} ${where} AND NOT r.unmatched_route
                    GROUP BY r.method, r.route ORDER BY calls DESC LIMIT 200`,
            values,
        });
        return res.status(200).json({ code: 200, message: "Route metrics", data: { rows } });
    } catch (e) {
        log.error(`An exception occurred while reading route metrics: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the API metrics. Try again in a moment." });
    }
};

module.exports = get_route_metrics;
