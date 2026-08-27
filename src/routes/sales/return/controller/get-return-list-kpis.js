const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// KPI strip for the returns list.
//
// The four figures answer four different questions: what needs action now
// (pending), how much is coming back (this month), what the shop still owes
// (refund outstanding), and what the returns did to stock (restocked vs disposed).
const get_return_list_kpis = async (request, res) => {
    try {
        const rows = await get_data({
            text: `WITH month_returns AS (
                         SELECT oid FROM ${TABLE.PRODUCT_RETURN}
                          WHERE status <> 'Cancelled'
                            AND created_on >= date_trunc('month', CURRENT_DATE)
                   )
                   SELECT
                         (SELECT COUNT(*)::int FROM ${TABLE.PRODUCT_RETURN} WHERE status = 'Pending') AS pending_count,
                         (SELECT COALESCE(SUM(rd.return_quantity), 0)::int
                            FROM ${TABLE.RETURN_DETAILS} rd
                            JOIN ${TABLE.PRODUCT_RETURN} pr ON pr.oid = rd.return_oid
                           WHERE pr.status = 'Pending') AS pending_units,
                         (SELECT COUNT(*)::int FROM month_returns) AS month_count,
                         (SELECT COALESCE(SUM(return_quantity), 0)::int
                            FROM ${TABLE.RETURN_DETAILS}
                           WHERE return_oid IN (SELECT oid FROM month_returns)) AS month_units,
                         (SELECT COALESCE(SUM(refund_amount), 0)::int
                            FROM ${TABLE.PRODUCT_RETURN} WHERE status = 'Returned') AS refund_outstanding,
                         (SELECT COALESCE(SUM(refund_amount), 0)::int
                            FROM ${TABLE.PRODUCT_RETURN}
                           WHERE status <> 'Cancelled'
                             AND created_on >= date_trunc('month', CURRENT_DATE)) AS month_refund_value,
                         (SELECT COALESCE(SUM(return_quantity), 0)::int
                            FROM ${TABLE.RETURN_DETAILS}
                           WHERE action = 'Restocked'
                             AND return_oid IN (SELECT oid FROM month_returns)) AS month_restocked_units,
                         (SELECT COALESCE(SUM(return_quantity), 0)::int
                            FROM ${TABLE.RETURN_DETAILS}
                           WHERE action = 'Disposed'
                             AND return_oid IN (SELECT oid FROM month_returns)) AS month_disposed_units`,
            values: [],
        });

        log.info(`Return KPIs found`);
        return res.status(200).json({ code: 200, message: "Return KPIs found", data: rows[0] || null });
    } catch (e) {
        log.error(`An exception occurred while getting return KPIs: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_return_list_kpis;
