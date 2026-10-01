const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../utils/sees-money");
const { LINES_SQL, TOTALS, without_money } = require("../utils/dispose-sql");

const DETAILS_SQL = `
      SELECT d.oid, d.dispose_no, to_char(d.disposal_date, 'YYYY-MM-DD') AS disposal_date, d.disposal_method AS method, d.status, d.notes AS note,
             d.reject_reason, d.cancel_reason,
             d.created_on, d.created_by, cu.name AS created_by_name,
             d.submitted_on, d.submitted_by, su.name AS submitted_by_name,
             d.approved_on, d.approved_by, au.name AS approved_by_name,
             d.rejected_on, d.rejected_by, ru.name AS rejected_by_name,
             d.cancelled_on, d.cancelled_by, xu.name AS cancelled_by_name,
             t.line_count, t.units, t.value
        FROM ${TABLE.PRODUCT_DISPOSE} d
        LEFT JOIN ${TABLE.LOGIN} cu ON cu.email = d.created_by
        LEFT JOIN ${TABLE.LOGIN} su ON su.email = d.submitted_by
        LEFT JOIN ${TABLE.LOGIN} au ON au.email = d.approved_by
        LEFT JOIN ${TABLE.LOGIN} ru ON ru.email = d.rejected_by
        LEFT JOIN ${TABLE.LOGIN} xu ON xu.email = d.cancelled_by
        ${TOTALS}
       WHERE d.oid = $1`;

const get_product_dispose_details = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[details], lines, activity, money] = await Promise.all([get_data({ text: DETAILS_SQL, values: [oid] }), get_data({ text: LINES_SQL, values: [oid] }), getLogActivities("product-dispose", oid, 20), sees_money(request)]);
            if (!details) return res.status(404).json({ code: 404, message: "That disposal no longer exists.", data: null });
            return res.status(200).json({
                  code: 200,
                  message: "Disposal",
                  data: {
                        details: money ? details : without_money(details),
                        lines: money ? lines : lines.map(without_money),
                        activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                        sees_money: money,
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while loading disposal ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load this disposal. Try again in a moment." });
      }
};

module.exports = get_product_dispose_details;
