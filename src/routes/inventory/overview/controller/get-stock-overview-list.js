const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { BATCH_FIGURES, PRODUCT_FIGURES, sees_money, without_money } = require("../utils/stock-figures");

// Every product that is not deleted and has ever had a batch, Active or Inactive: the old list showed
// Active products only, so an Inactive product's stock on the shelf appeared on no stock page at all.
// Low and out read sellable against the restock level, as the catalogue's product list does.
const FROM = `(
      SELECT p.oid, p.name, p.sku, p.photo, p.status, p.unit_type, p.restock_threshold::int AS restock_threshold,
             p.category_oid, c.name AS category_name, p.sub_category_oid, s.name AS sub_category_name, p.brand_oid, br.name AS brand_name,
             ${PRODUCT_FIGURES},
             string_agg(b.batch_code, ' ') AS batch_codes
        FROM ${TABLE.PRODUCT} p
        JOIN (${BATCH_FIGURES}) b ON b.product_oid = p.oid
        LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
        LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
        LEFT JOIN ${TABLE.BRANDS} br ON br.oid = p.brand_oid
       WHERE p.is_deleted = FALSE
       GROUP BY p.oid, c.name, s.name, br.name
) o`;

const STOCK_STATUS = `(CASE WHEN o.sellable = 0 THEN 'out' WHEN o.sellable <= o.restock_threshold THEN 'low' ELSE 'in' END)`;
const EXPIRY_STATE = `(CASE WHEN o.expired_units > 0 THEN 'expired' WHEN o.expiring_units > 0 THEN 'soon' END)`;

const SELECT = `o.oid, o.name, o.sku, replace(o.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb, o.status, o.unit_type, o.restock_threshold, o.category_name, o.sub_category_name, o.brand_name,
                o.on_hand, o.held, o.sellable, o.batches, o.unpriced_batches, o.expired_units, o.expiring_units,
                o.stock_value, o.internal_value, o.expiring_value, o.expected_revenue, o.profit_full, o.profit_discounted,
                ${STOCK_STATUS} AS stock_status, ${EXPIRY_STATE} AS expiry_state`;

const QUANTITY_STATS = {
      on_hand: `COALESCE(SUM(o.on_hand), 0)::int`,
      sellable: `COALESCE(SUM(o.sellable), 0)::int`,
      low: `COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'low')::int`,
      out: `COUNT(*) FILTER (WHERE ${STOCK_STATUS} = 'out')::int`,
      expiring_units: `COALESCE(SUM(o.expiring_units + o.expired_units), 0)::int`,
      unpriced_batches: `COALESCE(SUM(o.unpriced_batches), 0)::int`,
};

const MONEY_STATS = {
      stock_value: `COALESCE(SUM(o.stock_value), 0)::float8`,
      expected_revenue: `COALESCE(SUM(o.expected_revenue), 0)::float8`,
      profit_full: `COALESCE(SUM(o.profit_full), 0)::float8`,
      profit_discounted: `COALESCE(SUM(o.profit_discounted), 0)::float8`,
      expiring_value: `COALESCE(SUM(o.expiring_value), 0)::float8`,
      internal_value: `COALESCE(SUM(o.internal_value), 0)::float8`,
};

const QUANTITY_SORT = { name: "o.name", on_hand: "o.on_hand", sellable: "o.sellable", batches: "o.batches" };
const MONEY_SORT = { stock_value: "o.stock_value", expected_revenue: "o.expected_revenue", profit_full: "o.profit_full" };

const get_stock_overview_list = async (request, res) => {
      try {
            const money = await sees_money(request);
            const { rows, total, stats } = await read_list({
                  select: SELECT,
                  from: FROM,
                  search: ["o.name", "o.sku", "o.batch_codes"],
                  filters: { category_oid: "o.category_oid", sub_category_oid: "o.sub_category_oid", brand_oid: "o.brand_oid", stock_status: STOCK_STATUS, expiry_state: EXPIRY_STATE },
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
