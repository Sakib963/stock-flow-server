const { TABLE } = require("../../../../utils/constant");
const { business_day, business_local } = require("../../../../utils/business-time");
const { FROM, OWN_ROUTES } = require("./request-where");
const { THRESHOLDS } = require("./thresholds");

const LOCAL = business_local("r.occurred_on");

// Each signal groups matching requests into buckets, keeps the buckets over its threshold and sums
// them per account. A fixed bucket can miss a burst that straddles its edge.
const per_person = (inner) => `
    WITH s AS (${inner})
    SELECT s.subject AS oid, l.name, l.email, NULL AS ip, SUM(s.count)::int AS count, MIN(s.first_seen) AS first_seen, MAX(s.last_seen) AS last_seen
      FROM s LEFT JOIN ${TABLE.LOGIN} l ON l.oid = s.subject
     GROUP BY s.subject, l.name, l.email ORDER BY count DESC LIMIT 20`;

const SIGNALS = [
    {
        key: "list_sweeping",
        threshold: THRESHOLDS.list_sweeping_per_hour,
        sql: (where, t) =>
            per_person(`SELECT r.login_oid AS subject, COUNT(*) AS count, MIN(r.occurred_on) AS first_seen, MAX(r.occurred_on) AS last_seen
                          FROM ${FROM} ${where} AND ${OWN_ROUTES} AND r.login_oid IS NOT NULL AND r.method = 'GET' AND r.route ~ '-list$'
                         GROUP BY r.login_oid, date_trunc('hour', ${LOCAL}) HAVING COUNT(*) > ${t}`),
    },
    {
        key: "many_addresses",
        threshold: THRESHOLDS.many_addresses_per_day,
        sql: (where, t) =>
            per_person(`SELECT r.login_oid AS subject, COUNT(DISTINCT r.ip) AS count, MIN(r.occurred_on) AS first_seen, MAX(r.occurred_on) AS last_seen
                          FROM ${FROM} ${where} AND ${OWN_ROUTES} AND r.login_oid IS NOT NULL AND r.ip IS NOT NULL
                         GROUP BY r.login_oid, ${business_day("r.occurred_on")} HAVING COUNT(DISTINCT r.ip) > ${t}`),
    },
    {
        key: "off_hours",
        threshold: null,
        window: [THRESHOLDS.office_closes_hour, THRESHOLDS.office_opens_hour],
        sql: (where) =>
            per_person(`SELECT r.login_oid AS subject, COUNT(*) AS count, MIN(r.occurred_on) AS first_seen, MAX(r.occurred_on) AS last_seen
                          FROM ${FROM} ${where} AND ${OWN_ROUTES} AND r.login_oid IS NOT NULL
                           AND (EXTRACT(HOUR FROM ${LOCAL}) < ${THRESHOLDS.office_opens_hour} OR EXTRACT(HOUR FROM ${LOCAL}) >= ${THRESHOLDS.office_closes_hour})
                         GROUP BY r.login_oid`),
    },
    {
        key: "refusal_burst",
        threshold: THRESHOLDS.refusals_per_15_minutes,
        sql: (where, t) => `
            WITH s AS (SELECT r.ip, COUNT(*) AS count, MIN(r.occurred_on) AS first_seen, MAX(r.occurred_on) AS last_seen
                         FROM ${FROM} ${where} AND ${OWN_ROUTES} AND r.ip IS NOT NULL AND r.status IN (401, 403, 404)
                        GROUP BY r.ip, floor(EXTRACT(EPOCH FROM r.occurred_on) / 900) HAVING COUNT(*) > ${t})
            SELECT NULL AS oid, NULL AS name, NULL AS email, s.ip, SUM(s.count)::int AS count, MIN(s.first_seen) AS first_seen, MAX(s.last_seen) AS last_seen
              FROM s GROUP BY s.ip ORDER BY count DESC LIMIT 20`,
    },
    {
        key: "export_taken",
        threshold: null,
        sql: (where) =>
            per_person(`SELECT r.login_oid AS subject, COUNT(*) AS count, MIN(r.occurred_on) AS first_seen, MAX(r.occurred_on) AS last_seen
                          FROM ${FROM} ${where} AND ${OWN_ROUTES} AND r.login_oid IS NOT NULL AND r.status < 400 AND r.route ~ '(report|export)' AND r.route !~ '-code$'
                         GROUP BY r.login_oid`),
    },
];

module.exports = { SIGNALS };
