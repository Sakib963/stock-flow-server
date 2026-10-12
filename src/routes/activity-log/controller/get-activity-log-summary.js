const { get_data } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { business_local } = require("../../../utils/business-time");
const { AREA, ATTENTION, FROM, activity_where } = require("../utils/activity-kinds");

const LOCAL = business_local("a.performed_on");

// The owner's picture of the period, over exactly the rows the feed shows: how much happened, who
// was at work and how much each did, which hour was busiest, how many entries are worth a look, how
// the work spreads over the areas, and when in the week the team works, on the business's own clock.
const get_activity_log_summary = async (request, res) => {
    try {
        const { where, values } = activity_where(request.query);
        const [totals, people, hours, areas, week] = await Promise.all([
            get_data({ text: `SELECT COUNT(*)::int AS actions, COUNT(*) FILTER (WHERE ${ATTENTION})::int AS attention, COUNT(DISTINCT a.performed_by)::int AS people_count FROM ${FROM} ${where}`, values }),
            get_data({
                text: `SELECT a.performed_by AS email, MAX(l.name) AS name, COUNT(*)::int AS actions, MAX(a.performed_on) AS last_seen
                         FROM ${FROM} ${where} GROUP BY a.performed_by ORDER BY actions DESC, last_seen DESC LIMIT 50`,
                values,
            }),
            get_data({ text: `SELECT EXTRACT(HOUR FROM ${LOCAL})::int AS hour, COUNT(*)::int AS actions FROM ${FROM} ${where} GROUP BY 1 ORDER BY actions DESC, hour LIMIT 1`, values }),
            get_data({ text: `SELECT ${AREA} AS area, COUNT(*)::int AS actions FROM ${FROM} ${where} GROUP BY 1 ORDER BY actions DESC`, values }),
            // ISO weekday 1 (Monday) to 7 (Sunday), and the hour, for the heatmap.
            get_data({ text: `SELECT EXTRACT(ISODOW FROM ${LOCAL})::int AS day, EXTRACT(HOUR FROM ${LOCAL})::int AS hour, COUNT(*)::int AS actions FROM ${FROM} ${where} GROUP BY 1, 2`, values }),
        ]);
        return res.status(200).json({
            code: 200,
            message: "Activity summary",
            data: { actions: totals[0]?.actions ?? 0, attention: totals[0]?.attention ?? 0, people_count: totals[0]?.people_count ?? 0, busiest_hour: hours[0]?.hour ?? null, people, areas, week },
        });
    } catch (e) {
        log.error(`An exception occurred while summarising the activity log: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the activity summary. Try again in a moment." });
    }
};

module.exports = get_activity_log_summary;
