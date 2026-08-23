const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Per-line booked vs sellable (FR-34). This drives the all-or-nothing gate (D4):
// Create Order stays disabled until EVERY line is fulfillable.
//
// Readiness is judged on SELLABLE stock (on-hand minus active holds) across all
// of the product's ready_for_sale batches, because a pre-order line has no batch
// of its own to check.
const get_stock_readiness = async (request, res) => {
    try {
        const pre_order_oid = request.query.oid;

        const items = await get_data({
            text: `
                WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE})
                SELECT poi.oid AS pre_order_item_oid,
                       poi.product_oid,
                       poi.product_name,
                       CAST(poi.quantity AS INTEGER) AS required_quantity,
                       COALESCE(s.sellable_quantity, 0) AS sellable_quantity,
                       (COALESCE(s.sellable_quantity, 0) >= poi.quantity) AS is_ready,
                       GREATEST(poi.quantity - COALESCE(s.sellable_quantity, 0), 0)::int AS shortfall
                  FROM ${TABLE.PRE_ORDER_ITEMS} poi
                  LEFT JOIN sellable s ON s.product_oid = poi.product_oid
                 WHERE poi.pre_order_oid = $1
                 ORDER BY is_ready ASC, poi.product_name ASC
            `,
            values: [pre_order_oid],
        });

        const isReady = items.length > 0 && items.every((i) => i.is_ready);
        const blocking = items.filter((i) => !i.is_ready).length;

        log.info(`Stock readiness for pre-order ${pre_order_oid}: ${isReady ? "ready" : `${blocking} line(s) short`}`);
        return res.status(200).json({
            code: 200,
            message: "Stock readiness found",
            total: items.length,
            data: { isReady, blockingCount: blocking, items },
        });
    } catch (e) {
        log.error(`An exception occurred while getting stock readiness: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_stock_readiness;
