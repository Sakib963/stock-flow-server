const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../utils/sees-money");
const { LINES_SQL, TOTALS, without_money } = require("../utils/adjustment-sql");

const DETAILS_SQL = `
      SELECT s.oid, s.adjustment_number, s.reason, s.status, s.note, s.reject_reason, s.cancel_reason,
             s.created_on, s.created_by, cu.name AS created_by_name,
             s.submitted_on, s.submitted_by, su.name AS submitted_by_name,
             s.verified_on, s.verified_by, vu.name AS verified_by_name,
             s.rejected_on, s.rejected_by, ru.name AS rejected_by_name,
             s.cancelled_on, s.cancelled_by, xu.name AS cancelled_by_name,
             t.line_count, t.units_in, t.units_out, t.value_in, t.value_out
        FROM ${TABLE.STOCK_ADJUSTMENT} s
        LEFT JOIN ${TABLE.LOGIN} cu ON cu.email = s.created_by
        LEFT JOIN ${TABLE.LOGIN} su ON su.email = s.submitted_by
        LEFT JOIN ${TABLE.LOGIN} vu ON vu.email = s.verified_by
        LEFT JOIN ${TABLE.LOGIN} ru ON ru.email = s.rejected_by
        LEFT JOIN ${TABLE.LOGIN} xu ON xu.email = s.cancelled_by
        ${TOTALS}
       WHERE s.oid = $1`;

const get_stock_adjustment_details = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[details], lines, activity, money] = await Promise.all([get_data({ text: DETAILS_SQL, values: [oid] }), get_data({ text: LINES_SQL, values: [oid] }), getLogActivities("stock-adjustment", oid, 20), sees_money(request)]);
            if (!details) return res.status(404).json({ code: 404, message: "That adjustment no longer exists.", data: null });

            return res.status(200).json({
                  code: 200,
                  message: "Stock adjustment",
                  data: {
                        details: money ? details : without_money(details),
                        lines: money ? lines : lines.map(without_money),
                        activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                        sees_money: money,
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while loading stock adjustment ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load this adjustment. Try again in a moment." });
      }
};

module.exports = get_stock_adjustment_details;
