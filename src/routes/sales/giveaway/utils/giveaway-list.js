const { TABLE } = require("../../../../utils/constant");
const { business_month_start } = require("../../../../utils/business-time");

const LIST = {
    select: `g.oid, g.giveaway_no, g.customer_oid, g.order_oid, g.recipient_name, g.recipient_phone, g.note, g.status, g.given_on, g.created_on,
             u.name AS created_by_name, l.units, l.cost`,
    from: `${TABLE.GIVEAWAY} g
           LEFT JOIN ${TABLE.LOGIN} u ON u.email = g.created_by
           LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(gl.quantity), 0)::int AS units, COALESCE(SUM(gl.quantity * gl.cost_price), 0)::int AS cost
                  FROM ${TABLE.GIVEAWAY_LINE} gl WHERE gl.giveaway_oid = g.oid) l ON true`,
    search: ["g.giveaway_no", "g.recipient_name", "g.recipient_phone"],
    filters: { status: "g.status", order_oid: "g.order_oid" },
    sortable: { created_on: "g.created_on", giveaway_no: "g.giveaway_no" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "g.oid",
};

const STATS = {
    drafts: `COUNT(*) FILTER (WHERE g.status = 'Draft')::int`,
    given_this_month: `COUNT(*) FILTER (WHERE g.status = 'Given' AND g.given_on >= ${business_month_start})::int`,
    units_this_month: `COALESCE(SUM(l.units) FILTER (WHERE g.status = 'Given' AND g.given_on >= ${business_month_start}), 0)::int`,
    cost_this_month: `COALESCE(SUM(l.cost) FILTER (WHERE g.status = 'Given' AND g.given_on >= ${business_month_start}), 0)::int`,
};

module.exports = { LIST, STATS };
