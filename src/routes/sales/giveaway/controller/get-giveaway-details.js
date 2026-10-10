const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../../inventory/utils/sees-money");

// One giveaway with its lines and its activity. Cost is left out for someone without inventory.stock-value.view.
const get_giveaway_details = async (request, res) => {
    try {
        const oid = request.params.oid;
        const [details] = await get_data({
            text: `SELECT g.oid, g.giveaway_no, g.customer_oid, g.recipient_name, g.recipient_phone, g.address_line, g.note, g.status, g.cancel_reason,
                          g.given_on, COALESCE(gl.name, g.given_by) AS given_by, g.created_on, COALESCE(cl.name, g.created_by) AS created_by
                     FROM ${TABLE.GIVEAWAY} g
                     LEFT JOIN ${TABLE.LOGIN} cl ON cl.email = g.created_by
                     LEFT JOIN ${TABLE.LOGIN} gl ON gl.email = g.given_by
                    WHERE g.oid = $1`,
            values: [oid],
        });
        if (!details) return res.status(404).json({ code: 404, message: "No giveaway with that number." });

        const lines = await get_data({
            text: `SELECT gl.oid, gl.inventory_oid, gl.product_oid, p.name AS product_name, i.batch_code, gl.quantity, gl.cost_price::int AS cost_price
                     FROM ${TABLE.GIVEAWAY_LINE} gl
                     JOIN ${TABLE.PRODUCT} p ON p.oid = gl.product_oid
                     JOIN ${TABLE.INVENTORY} i ON i.oid = gl.inventory_oid
                    WHERE gl.giveaway_oid = $1 ORDER BY p.name`,
            values: [oid],
        });
        if (!(await sees_money(request))) for (const line of lines) delete line.cost_price;
        const activity = await get_data({
            text: `SELECT a.title, a.description, COALESCE(u.name, a.performed_by) AS performed_by, a.performed_on
                     FROM ${TABLE.ACTIVITY_LOG} a LEFT JOIN ${TABLE.LOGIN} u ON u.email = a.performed_by
                    WHERE a.reference_type = 'giveaway' AND a.reference_oid = $1 ORDER BY a.performed_on DESC`,
            values: [oid],
        });
        return res.status(200).json({ code: 200, message: "Giveaway", data: { ...details, lines, activity } });
    } catch (e) {
        log.error(`An exception occurred while reading a giveaway: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the giveaway. Try again in a moment." });
    }
};

module.exports = get_giveaway_details;
