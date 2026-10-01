const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../utils/sees-money");
const { TOTALS, without_money } = require("../utils/adjustment-sql");
const { business_month_start } = require("../../../../utils/business-time");

const SELECT = `s.oid, s.adjustment_number, s.reason, s.status, s.note, s.created_on, s.created_by, u.name AS created_by_name,
                t.line_count, t.units_in, t.units_out, t.value_in, t.value_out`;

const FROM = `${TABLE.STOCK_ADJUSTMENT} s
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = s.created_by
              ${TOTALS}`;

const THIS_MONTH = (column) => `${column} >= ${business_month_start}`;

const STATS = {
      draft: `COUNT(*) FILTER (WHERE s.status = 'Draft')::int`,
      submitted: `COUNT(*) FILTER (WHERE s.status = 'Submitted')::int`,
      verified_this_month: `COUNT(*) FILTER (WHERE s.status = 'Verified' AND ${THIS_MONTH("s.verified_on")})::int`,
      rejected_this_month: `COUNT(*) FILTER (WHERE s.status = 'Rejected' AND ${THIS_MONTH("s.rejected_on")})::int`,
};

const get_stock_adjustment_list = async (request, res) => {
      try {
            const [{ rows, total, stats }, money] = await Promise.all([
                  read_list({
                        select: SELECT,
                        from: FROM,
                        search: ["s.adjustment_number", "s.note"],
                        filters: { status: "s.status", reason: "s.reason" },
                        sortable: { adjustment_number: "s.adjustment_number", reason: "s.reason", status: "s.status", created_on: "s.created_on" },
                        default_sort: { key: "created_on", order: "desc" },
                        stats: STATS,
                        tie_breaker: "s.oid",
                        query: request.query,
                  }),
                  sees_money(request),
            ]);
            const shown = money ? rows : rows.map(without_money);
            return res.status(200).json({ code: 200, message: "Stock adjustments", data: stats ? { rows: shown, stats } : { rows: shown }, total });
      } catch (e) {
            log.error(`An exception occurred while listing stock adjustments: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load stock adjustments. Try again in a moment." });
      }
};

module.exports = get_stock_adjustment_list;
