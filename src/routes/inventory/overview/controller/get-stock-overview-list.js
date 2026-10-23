const { TABLE } = require("../../../../utils/constant");
const { business_today, business_day_start } = require("../../../../utils/business-time");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { PRODUCT_STOCK, STOCK_STATUS, EXPIRY_STATE, without_money } = require("../utils/stock-figures");
const { sees_money } = require("../../utils/sees-money");

// Kept sales per product, as the product page and the reports count them: units customers kept from
// orders with sold_on, the last 30 business days and the last time any unit was kept. Quantities only.
const SALES = `(
      SELECT oi.product_oid,
             COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE o.sold_on >= ${business_day_start(`${business_today} - 29`)}), 0)::int AS sold_30_days,
             MAX(o.sold_on) FILTER (WHERE oi.quantity > oi.returned_qty) AS last_sold_on
        FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid
       WHERE o.sold_on IS NOT NULL
       GROUP BY oi.product_oid
) sa`;
const FROM = `${PRODUCT_STOCK} LEFT JOIN ${SALES} ON sa.product_oid = o.oid`;
const SOLD_30 = "COALESCE(sa.sold_30_days, 0)";
// How long what can be sold now lasts at the last 30 days' pace; none without a sale to measure by.
const DAYS_LEFT = `(CASE WHEN ${SOLD_30} > 0 THEN floor(o.sellable / (${SOLD_30} / 30.0))::int END)`;
// Stock that could be sold and has not sold for 60 business days.
const NOT_SELLING = `(CASE WHEN o.sellable > 0 AND (sa.last_sold_on IS NULL OR sa.last_sold_on < ${business_day_start(`${business_today} - 59`)}) THEN 'true' ELSE 'false' END)`;

const SELECT = `o.oid, o.name, o.sku, replace(o.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb, o.status, o.unit_type, o.restock_threshold, o.category_name, o.sub_category_name, o.brand_name,
                o.on_hand, o.held, o.sellable, o.batches, o.unpriced_batches, o.expired_units, o.expiring_units,
                o.stock_value, o.internal_value, o.expiring_value, o.expected_revenue, o.profit_full, o.profit_discounted,
                ${STOCK_STATUS} AS stock_status, ${EXPIRY_STATE} AS expiry_state,
                ${SOLD_30} AS sold_30_days, ${DAYS_LEFT} AS days_left, sa.last_sold_on`;

const QUANTITY_STATS = {
      on_hand: `COALESCE(SUM(o.on_hand), 0)::int`,
      sellable: `COALESCE(SUM(o.sellable), 0)::int`,
      low: `COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'low')::int`,
      out: `COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'out')::int`,
      expiring_units: `COALESCE(SUM(o.expiring_units + o.expired_units), 0)::int`,
      unpriced_batches: `COALESCE(SUM(o.unpriced_batches), 0)::int`,
      not_selling: `COUNT(*) FILTER (WHERE ${NOT_SELLING} = 'true')::int`,
};

const MONEY_STATS = {
      stock_value: `COALESCE(SUM(o.stock_value), 0)::float8`,
      expected_revenue: `COALESCE(SUM(o.expected_revenue), 0)::float8`,
      profit_full: `COALESCE(SUM(o.profit_full), 0)::float8`,
      profit_discounted: `COALESCE(SUM(o.profit_discounted), 0)::float8`,
      expiring_value: `COALESCE(SUM(o.expiring_value), 0)::float8`,
      internal_value: `COALESCE(SUM(o.internal_value), 0)::float8`,
};

// A product never sold sorts as the oldest sale, so newest first opens on what sold most recently.
const QUANTITY_SORT = { name: "o.name", on_hand: "o.on_hand", sellable: "o.sellable", batches: "o.batches", sold_30_days: SOLD_30, days_left: DAYS_LEFT, last_sold_on: "COALESCE(sa.last_sold_on, '-infinity')" };
const MONEY_SORT = { stock_value: "o.stock_value", expected_revenue: "o.expected_revenue", profit_full: "o.profit_full" };

const get_stock_overview_list = async (request, res) => {
      try {
            const money = await sees_money(request);
            const { rows, total, stats } = await read_list({
                  select: SELECT,
                  from: FROM,
                  search: ["o.name", "o.sku", "o.batch_codes"],
                  filters: { category_oid: "o.category_oid", sub_category_oid: "o.sub_category_oid", brand_oid: "o.brand_oid", stock_status: STOCK_STATUS, expiry_state: EXPIRY_STATE, not_selling: NOT_SELLING },
                  // Sorting by a hidden figure would still reveal it through the order.
                  sortable: money ? { ...QUANTITY_SORT, ...MONEY_SORT } : QUANTITY_SORT,
                  default_sort: { key: "name", order: "asc" },
                  stats: money ? { ...QUANTITY_STATS, ...MONEY_STATS } : QUANTITY_STATS,
                  query: request.query,
                  tie_breaker: "o.oid",
            });
            const shown = money ? rows : rows.map(without_money);
            return res.status(200).json({ code: 200, message: "Stock overview", data: stats ? { rows: shown, stats } : { rows: shown }, total });
      } catch (e) {
            log.error(`An exception occurred while listing the stock overview: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load the stock overview. Try again in a moment." });
      }
};

module.exports = get_stock_overview_list;
