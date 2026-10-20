const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { business_day, business_local } = require("../../../../utils/business-time");
const { FROM, request_where } = require("../utils/request-where");

const get_observability_usage = async (request, res) => {
    try {
        const { where, values } = request_where(request.query);
        const [last, daily, month_days, people, [{ people_count }]] = await Promise.all([
            get_data({ text: `SELECT r.occurred_on, r.method, r.route, l.name, l.email FROM ${FROM} WHERE r.login_oid IS NOT NULL ORDER BY r.occurred_on DESC LIMIT 1` }),
            get_data({
                text: `SELECT to_char(${business_day("r.occurred_on")}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS requests, COUNT(DISTINCT r.login_oid)::int AS people
                         FROM ${FROM} ${where} GROUP BY 1 ORDER BY 1`,
                values,
            }),
            get_data({ text: `SELECT EXTRACT(DAY FROM ${business_local("r.occurred_on")})::int AS day, COUNT(*)::int AS requests FROM ${FROM} ${where} GROUP BY 1 ORDER BY 1`, values }),
            get_data({
                text: `SELECT r.login_oid AS oid, MAX(l.name) AS name, MAX(l.email) AS email, COUNT(*)::int AS requests, MAX(r.occurred_on) AS last_seen
                         FROM ${FROM} ${where} AND r.login_oid IS NOT NULL GROUP BY r.login_oid ORDER BY requests DESC LIMIT 50`,
                values,
            }),
            get_data({ text: `SELECT COUNT(DISTINCT r.login_oid)::int AS people_count FROM ${FROM} ${where}`, values }),
        ]);
        return res.status(200).json({ code: 200, message: "Usage", data: { last_active: last[0] ?? null, daily, month_days, people, people_count } });
    } catch (e) {
        log.error(`An exception occurred while reading usage: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load usage. Try again in a moment." });
    }
};

module.exports = get_observability_usage;
