const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { business_day, business_local, business_today, business_day_start } = require("../../../utils/business-time");
const { AREA, RECORD_EXISTS } = require("../../activity-log/utils/activity-kinds");

const DAYS_SQL = `
    SELECT to_char(${business_day("a.performed_on")}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS actions
      FROM ${TABLE.ACTIVITY_LOG} a
     WHERE a.performed_by = $1 AND a.performed_on >= ${business_day_start(`${business_today} - 365`)}
     GROUP BY 1`;

// Eight whole weeks, so every weekday is counted the same number of times.
const WEEK_SQL = `
    SELECT EXTRACT(ISODOW FROM ${business_local("a.performed_on")})::int AS day, EXTRACT(HOUR FROM ${business_local("a.performed_on")})::int AS hour, COUNT(*)::int AS count
      FROM ${TABLE.ACTIVITY_LOG} a
     WHERE a.performed_by = $1 AND a.performed_on >= ${business_day_start(`${business_today} - 55`)}
     GROUP BY 1, 2`;

const RECENT_SQL = `
    SELECT a.oid, a.reference_type, a.reference_oid, a.title, a.description, a.performed_on, ${AREA} AS area, ${RECORD_EXISTS} AS record_exists
      FROM ${TABLE.ACTIVITY_LOG} a
     WHERE a.performed_by = $1
     ORDER BY a.performed_on DESC
     LIMIT 5`;

const shift = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const streak_of = (active, today) => {
    let day = active.has(today) ? today : shift(today, -1);
    let streak = 0;
    while (active.has(day)) {
        streak += 1;
        day = shift(day, -1);
    }
    return streak;
};

const read_your_work = async ({ user_id, today }) => {
    const [days, week, recent] = await Promise.all([get_data({ text: DAYS_SQL, values: [user_id] }), get_data({ text: WEEK_SQL, values: [user_id] }), get_data({ text: RECENT_SQL, values: [user_id] })]);
    const active = new Set(days.map((d) => d.day));
    const month_ago = shift(today, -30);
    return {
        today: days.find((d) => d.day === today)?.actions ?? 0,
        active_days: days.filter((d) => d.day > month_ago).length,
        streak: streak_of(active, today),
        week,
        recent,
    };
};

module.exports = { read_your_work };
