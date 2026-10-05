const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");

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

// The actions change online orders only, so they need the online channel as well as their own
// permission (sales REQ-02): a person who cannot see an order must not be able to move it.
const online_sellers = async (request, res, next) => {
    try {
        if ((await channels_of(request)).includes("ONLINE")) return next();
    } catch (e) {
        log.error(`Could not read the channels for an order action: ${e?.message}`);
    }
    return res.status(403).json({ code: 403, message: "Only someone who sells online can change an online order.", data: null });
};

// Order history: the same list, record and actions as Orders, held to the orders the person placed.
const own_orders = (request, res, next) => {
    request.own_orders = true;
    next();
};

/** In Order history an action reaches only the person's own order; anyone else's is as if it did not exist. */
const refuse_unless_own = async (tx, oid, request) => {
    if (!request.own_orders) return;
    const [order] = await tx.get_data({ text: `SELECT created_by FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [oid] });
    if (order?.created_by !== request.credentials.user_id) fail(404, "No order of yours with that number.");
};

module.exports = { refuse_change, online_sellers, own_orders, refuse_unless_own };
