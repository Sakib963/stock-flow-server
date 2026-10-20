const { TABLE, CONTEXTS, SUB_CONTEXTS } = require("../../../../utils/constant");
const { business_day_start } = require("../../../../utils/business-time");

const FROM = `${TABLE.API_REQUEST_LOG} r LEFT JOIN ${TABLE.LOGIN} l ON l.oid = r.login_oid`;

/** This screen's own calls: kept in the log, left out of the signals so looking does not raise one. */
const OWN_ROUTES = `r.route NOT LIKE '${CONTEXTS.SYSTEM}${SUB_CONTEXTS.OBSERVABILITY}%'`;

const STATUS_CLASS = { "2xx": [200, 299], "3xx": [300, 399], "4xx": [400, 499], "5xx": [500, 599] };

const request_where = (query) => {
    const values = [];
    const add = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    const clauses = [`r.occurred_on >= ${business_day_start(`${add(query.date_from)}::date`)}`, `r.occurred_on < ${business_day_start(`${add(query.date_to)}::date + 1`)}`];
    if (query.person) clauses.push(`l.email = ${add(query.person)}`);
    if (query.ip) clauses.push(`r.ip = ${add(query.ip)}`);
    if (query.country) clauses.push(`r.country = ${add(query.country)}`);
    if (query.route) clauses.push(`r.route = ${add(query.route)}`);
    if (query.request_id) clauses.push(`r.oid = ${add(query.request_id)}`);
    if (query.status) clauses.push(`r.status BETWEEN ${add(STATUS_CLASS[query.status][0])} AND ${add(STATUS_CLASS[query.status][1])}`);
    return { where: `WHERE ${clauses.join(" AND ")}`, values };
};

module.exports = { FROM, OWN_ROUTES, STATUS_CLASS, request_where };
