const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../utils/sees-money");
const { TOTALS, without_money } = require("../utils/dispose-sql");
const { business_month_start } = require("../../../../utils/business-time");

const SELECT = `d.oid, d.dispose_no, to_char(d.disposal_date, 'YYYY-MM-DD') AS disposal_date, d.disposal_method AS method, d.status, d.notes AS note,
                d.created_on, d.created_by, u.name AS created_by_name, t.line_count, t.units, t.value`;

const FROM = `${TABLE.PRODUCT_DISPOSE} d
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = d.created_by
              ${TOTALS}`;

const APPROVED_THIS_MONTH = `d.status = 'Approved' AND d.approved_on >= ${business_month_start}`;

const STATS = {
      draft: `COUNT(*) FILTER (WHERE d.status = 'Draft')::int`,
      submitted: `COUNT(*) FILTER (WHERE d.status = 'Submitted')::int`,
      approved_this_month: `COUNT(*) FILTER (WHERE ${APPROVED_THIS_MONTH})::int`,
      value_this_month: `COALESCE(SUM(t.value) FILTER (WHERE ${APPROVED_THIS_MONTH}), 0)::float8`,
};

const get_product_dispose_list = async (request, res) => {
      try {
            const [{ rows, total, stats }, money] = await Promise.all([
                  read_list({
                        select: SELECT,
                        from: FROM,
                        search: ["d.dispose_no", "d.notes"],
                        filters: { status: "d.status" },
                        sortable: { dispose_no: "d.dispose_no", disposal_date: "d.disposal_date", status: "d.status", created_on: "d.created_on" },
                        default_sort: { key: "created_on", order: "desc" },
                        stats: STATS,
                        tie_breaker: "d.oid",
                        query: request.query,
                  }),
                  sees_money(request),
            ]);
            const shown = money ? rows : rows.map(without_money);
            return res.status(200).json({ code: 200, message: "Disposals", data: stats ? { rows: shown, stats: money ? stats : without_money(stats) } : { rows: shown }, total });
      } catch (e) {
            log.error(`An exception occurred while listing disposals: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load disposals. Try again in a moment." });
      }
};

module.exports = get_product_dispose_list;
