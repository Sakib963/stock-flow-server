const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// KPI strip above the pre-order list (FR-36).
//   openCount     -- bookings that can still become an order
//   advanceHeld   -- money taken but NOT yet revenue; a liability (FR-38)
//   readyToConvert-- open bookings whose every line is now fulfillable
//   overdueCount  -- open bookings past their expected date
const get_pre_order_list_kpis = async (request, res) => {
    try {
        const sql = {
            text: `
                WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE}),
                open_pre_orders AS (
                    SELECT oid, expected_date, advance_paid, advance_refunded
                      FROM ${TABLE.PRE_ORDERS}
                     WHERE status IN ('Pending', 'Confirmed')
                ),
                readiness AS (
                    SELECT o.oid,
                           BOOL_AND(COALESCE(s.sellable_quantity, 0) >= poi.quantity) AS is_ready
                      FROM open_pre_orders o
                      JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = o.oid
                      LEFT JOIN sellable s ON s.product_oid = poi.product_oid
                     GROUP BY o.oid
                )
                SELECT (SELECT COUNT(*)::int FROM open_pre_orders) AS open_count,
                       (SELECT COALESCE(SUM(advance_paid - advance_refunded), 0)::int FROM open_pre_orders) AS advance_held,
                       (SELECT COUNT(*)::int FROM readiness WHERE is_ready) AS ready_to_convert,
                       (SELECT COUNT(*)::int FROM open_pre_orders WHERE expected_date IS NOT NULL AND expected_date < CURRENT_DATE) AS overdue_count
            `,
            values: [],
        };

        const rows = await get_data(sql);
        const row = rows.length ? rows[0] : {};

        const data = {
            openCount: parseInt(row.open_count) || 0,
            advanceHeld: parseInt(row.advance_held) || 0,
            readyToConvert: parseInt(row.ready_to_convert) || 0,
            overdueCount: parseInt(row.overdue_count) || 0,
        };

        log.info(`Pre-order KPIs: ${data.openCount} open, ${data.readyToConvert} ready, ${data.overdueCount} overdue`);
        return res.status(200).json({ code: 200, message: "Pre-order KPIs found", data });
    } catch (e) {
        log.error(`An exception occurred while getting pre-order KPIs: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_pre_order_list_kpis;
