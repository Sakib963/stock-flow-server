const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Every return raised against one order, for the Returns section on the order
// detail page. Also reports how many units are claimed by an unconfirmed return,
// which is what the order page uses to warn that stock has not moved yet.
const get_returns_for_order = async (request, res) => {
    try {
        const order_oid = request.query.order_oid;

        const data = await get_data({
            text: `SELECT pr.oid,
                          pr.invoice_no AS return_no,
                          CAST(pr.refund_amount AS INTEGER) AS refund_amount,
                          pr.return_reason,
                          pr.status,
                          pr.created_on,
                          COALESCE(l.name, pr.created_by) AS created_by,
                          COALESCE(u.units, 0)::int AS units
                     FROM ${TABLE.PRODUCT_RETURN} pr
                     LEFT JOIN ${TABLE.LOGIN} l ON l.email = pr.created_by
                     LEFT JOIN (
                           SELECT return_oid, SUM(return_quantity)::int AS units
                             FROM ${TABLE.RETURN_DETAILS}
                            GROUP BY return_oid
                     ) u ON u.return_oid = pr.oid
                    WHERE pr.order_oid = $1
                    ORDER BY pr.created_on DESC`,
            values: [order_oid],
        });

        const pending_units = data.filter((r) => r.status === "Pending").reduce((s, r) => s + Number(r.units), 0);

        log.info(`Returns for order ${order_oid}: ${data.length}`);
        return res.status(200).json({
            code: 200,
            message: "Returns found",
            total: data.length,
            data: { returns: data, pending_count: data.filter((r) => r.status === "Pending").length, pending_units },
        });
    } catch (e) {
        log.error(`An exception occurred while getting returns for an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_returns_for_order;
