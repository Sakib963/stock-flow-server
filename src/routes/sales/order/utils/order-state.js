const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

/**
 * Every order action changes a row only from the state it leaves, so two people pressing at once
 * cannot both win. When nothing changed, this says why: no such online order, or the state it is in
 * now, so the person sees what someone else already did.
 */
const refuse_change = async (tx, oid, action) => {
    const [order] = await tx.get_data({
        text: `SELECT o.invoice_no, o.status, o.dispatched_on, oo.delivery_status FROM ${TABLE.ORDERS} o LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                WHERE o.oid = $1 AND o.channel = 'ONLINE' AND o.status <> 'Draft'`,
        values: [oid],
    });
    if (!order) fail(404, "No online order with that number.");
    const state = order.delivery_status ? `${order.status}, ${order.delivery_status}` : order.status;
    fail(409, `${order.invoice_no} cannot be ${action} now: it is ${state}. Reload the order to see what changed.`, { status: order.status, delivery_status: order.delivery_status });
};

module.exports = { refuse_change };
