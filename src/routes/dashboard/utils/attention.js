const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { business_today } = require("../../../utils/business-time");
const { LIST: PRE_ORDER_LIST, READY, OVERDUE } = require("../../sales/pre-order/utils/pre-order-list");
const { PRODUCT_STOCK, STOCK_STATUS, EXPIRY_STATE } = require("../../inventory/overview/utils/stock-figures");

const at = (column) => `${column} AT TIME ZONE current_setting('TimeZone')`;

// Each count is the same definition as the card above its own list, so the number on the dashboard is
// the number the list opens with. Order counts are limited to the channels the person sells through.
// One query may answer several rows, such as out of stock and low on stock. A row needs the action it
// asks for and the view of the list it opens, or it would lead to a closed page.
const CHECKS = [
    {
        permissions: ["sales.order.confirm", "sales.order.view"],
        channels: true,
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("o.created_on")}) AS oldest_on FROM ${TABLE.ORDERS} o WHERE o.status = 'Pending' AND o.channel = ANY($1)`,
        rows: (r) => [{ key: "orders_to_confirm", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["sales.order.dispatch", "sales.order.view"],
        channels: true,
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("o.created_on")}) AS oldest_on FROM ${TABLE.ORDERS} o WHERE o.status = 'Confirmed' AND o.dispatched_on IS NULL AND o.channel = ANY($1)`,
        rows: (r) => [{ key: "orders_to_dispatch", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["sales.delivery-batch.deliver", "sales.order.view"],
        channels: true,
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("o.dispatched_on")}) AS oldest_on FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid WHERE oo.delivery_status = 'WithCourier' AND o.channel = ANY($1)`,
        rows: (r) => [{ key: "parcels_with_courier", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["sales.return.confirm", "sales.return.view"],
        channels: true,
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("pr.created_on")}) AS oldest_on, COUNT(*) FILTER (WHERE pr.return_reason = 'not_delivered')::int AS parcels
                FROM ${TABLE.PRODUCT_RETURN} pr JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid WHERE pr.status = 'Pending' AND o.channel = ANY($1)`,
        rows: (r) => [{ key: "returns_to_confirm", count: r.count, oldest_on: r.oldest_on, parcels: r.parcels }],
    },
    {
        permissions: ["sales.pre-order.convert", "sales.pre-order.view"],
        sql: `SELECT COUNT(*) FILTER (WHERE ${READY})::int AS ready, COUNT(*) FILTER (WHERE ${OVERDUE})::int AS overdue FROM ${PRE_ORDER_LIST.from}`,
        rows: (r) => [
            { key: "pre_orders_ready", count: r.ready },
            { key: "pre_orders_overdue", count: r.overdue },
        ],
    },
    {
        permissions: ["inventory.purchase-order.approve", "inventory.purchase-order.view"],
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("p.created_on")}) AS oldest_on FROM ${TABLE.PURCHASE} p WHERE p.status = 'Submitted'`,
        rows: (r) => [{ key: "purchase_orders_to_verify", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["inventory.product-dispose.approve", "inventory.product-dispose.view"],
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("COALESCE(d.submitted_on, d.created_on)")}) AS oldest_on FROM ${TABLE.PRODUCT_DISPOSE} d WHERE d.status = 'Submitted'`,
        rows: (r) => [{ key: "disposals_to_approve", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["inventory.stock-adjustment.approve", "inventory.stock-adjustment.view"],
        sql: `SELECT COUNT(*)::int AS count, MIN(${at("COALESCE(s.submitted_on, s.created_on)")}) AS oldest_on FROM ${TABLE.STOCK_ADJUSTMENT} s WHERE s.status = 'Submitted'`,
        rows: (r) => [{ key: "adjustments_to_verify", count: r.count, oldest_on: r.oldest_on }],
    },
    {
        permissions: ["inventory.overview.view"],
        sql: `SELECT COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'out')::int AS out, COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'low')::int AS low,
                     COUNT(*) FILTER (WHERE ${EXPIRY_STATE} IS NOT NULL)::int AS expiring, COUNT(*) FILTER (WHERE ${EXPIRY_STATE} = 'expired')::int AS expired
                FROM ${PRODUCT_STOCK}`,
        rows: (r) => [
            { key: "out_of_stock", count: r.out },
            { key: "low_on_stock", count: r.low },
            { key: "expiring", count: r.expiring, expired: r.expired },
        ],
    },
    {
        permissions: ["marketing.campaign.view"],
        sql: `SELECT COUNT(*)::int AS count, to_char(MIN(d.due_on), 'YYYY-MM-DD') AS oldest_day FROM ${TABLE.CAMPAIGN_DELIVERABLE} d WHERE d.status = 'Pending' AND d.due_on < ${business_today}`,
        rows: (r) => [{ key: "posts_past_due", count: r.count, oldest_day: r.oldest_day }],
    },
];

// Only what the person may act on, and only what is waiting: a row of zeros is noise. Null when the
// person holds none of these features, so the page leaves the section out instead of saying all clear.
const read_attention = async ({ held, channels }) => {
    const checks = CHECKS.filter((check) => check.permissions.every((code) => held.has(code)));
    if (!checks.length) return null;
    const answers = await Promise.all(checks.map(async (check) => check.rows((await get_data({ text: check.sql, values: check.channels ? [channels] : [] }))[0])));
    return answers.flat().filter((row) => row.count > 0);
};

module.exports = { read_attention, CHECKS };
