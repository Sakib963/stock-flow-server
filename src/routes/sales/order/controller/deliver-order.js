const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Mark a dispatched order DELIVERED. Only Confirmed + already-dispatched orders.
// Records COD collection when payment_collected is true (payment settled outside
// the app -- we only record status). No stock change (already deducted at dispatch).
const deliver_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const order_oid = request.body.oid;
    const collected = request.body.payment_collected === true;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await client.query({
            text: `UPDATE ${TABLE.ORDERS}
                      SET status = 'Delivered', delivered_on = clock_timestamp(),
                          payment_status = CASE WHEN $1 THEN 'paid' ELSE payment_status END,
                          tracking_token = COALESCE(tracking_token, $4),
                          edited_by = $2, edited_on = clock_timestamp()
                    WHERE oid = $3 AND status = 'Confirmed' AND dispatched_on IS NOT NULL
                    RETURNING invoice_no`,
            values: [collected, user_id, order_oid, crypto.randomBytes(16).toString("hex")],
        });

        if (!result.rowCount) {
            const cur = await client.query({ text: `SELECT status, dispatched_on FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
            await client.query("ROLLBACK");
            if (!cur.rowCount) return res.status(404).json({ code: 404, message: "Order not found" });
            if (!cur.rows[0].dispatched_on) return res.status(409).json({ code: 409, message: "Order must be sent for delivery before it can be marked delivered" });
            return res.status(409).json({ code: 409, message: `Cannot mark delivered from status ${cur.rows[0].status}` });
        }

        await recordStatusHistory(client, { order_oid, from_status: "Confirmed", to_status: "Delivered", reason: collected ? "Delivered; COD collected" : "Delivered", user_id });
        await client.query("COMMIT");

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Order Delivered", description: `Order ${result.rows[0].invoice_no} delivered${collected ? " (COD collected)" : ""}`, performed_by: user_id });
        log.info(`Order ${order_oid} delivered by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order marked delivered" });
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (r) { log.error(`Rollback failed on deliver: ${r?.message}`); }
        log.error(`An exception occurred while delivering order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = deliver_order;
