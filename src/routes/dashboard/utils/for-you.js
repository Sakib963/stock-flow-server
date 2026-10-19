const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { business_day } = require("../../../utils/business-time");
const { read_own_totals } = require("../../sales/analytics/utils/kept-sales");

// An online order counts on the day it was placed, its first move to Pending, never by created_on: a
// draft saved last night and placed this morning is this morning's, as sales analytics counts it.
// Became sales means kept: an order returned in full is left out.
const ONLINE_SQL = `
    WITH placed AS (
        SELECT h.order_oid, MIN(h.performed_on) AS placed_on
          FROM ${TABLE.ORDER_STATUS_HISTORY} h JOIN ${TABLE.ORDERS} o ON o.oid = h.order_oid
         WHERE h.kind = 'Order' AND h.to_status = 'Pending' AND o.channel = 'ONLINE' AND o.created_by = $1
         GROUP BY h.order_oid
    )
    SELECT COUNT(*) FILTER (WHERE ${business_day("p.placed_on")} BETWEEN $2::date AND $3::date)::int AS entered,
           COUNT(*) FILTER (WHERE ${business_day("p.placed_on")} BETWEEN $2::date AND $3::date AND o.sold_on IS NOT NULL AND o.status <> 'Returned')::int AS sold,
           COUNT(*) FILTER (WHERE ${business_day("p.placed_on")} BETWEEN $4::date AND $5::date)::int AS previous_entered
      FROM placed p JOIN ${TABLE.ORDERS} o ON o.oid = p.order_oid`;

// A parked cart is a counter draft, an unfinished online order an online one; each is seen only by
// the person who saved it (decided 2026-10-05).
const DRAFTS_SQL = `
    SELECT COUNT(*) FILTER (WHERE o.channel = 'POS')::int AS parked, COUNT(*) FILTER (WHERE o.channel = 'ONLINE')::int AS online
      FROM ${TABLE.ORDERS} o WHERE o.status = 'Draft' AND o.created_by = $1`;

// The person's own work in the period. Their own counter sales carry money even without sales
// analytics: they are the person's own (decided by the user, 2026-10-19).
const read_for_you = async ({ held, user_id, period }) => {
    const counter = held.has("sales.pos.create");
    const online = held.has("sales.online.create");
    if (!counter && !online) return null;

    const [own, previous, entered, drafts] = await Promise.all([
        counter ? read_own_totals(period.date_from, period.date_to, ["POS"], user_id) : null,
        counter ? read_own_totals(period.previous_from, period.previous_to, ["POS"], user_id) : null,
        online ? get_data({ text: ONLINE_SQL, values: [user_id, period.date_from, period.date_to, period.previous_from, period.previous_to] }) : null,
        get_data({ text: DRAFTS_SQL, values: [user_id] }),
    ]);

    return {
        counter: counter ? { sales: own.sales, orders: own.orders, previous_sales: previous.sales, previous_orders: previous.orders } : null,
        online: online ? entered[0] : null,
        drafts: { parked: counter ? drafts[0].parked : 0, online: online ? drafts[0].online : 0 },
    };
};

module.exports = { read_for_you };
