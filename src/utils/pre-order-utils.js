// Shared helpers for the Pre-Order feature.
// A pre-order is a booking for stock not yet held. It is neither a sale nor an
// order, so it keeps its own numbering and its own status history.
const { TABLE } = require("./constant");
const { v4: uuidv4 } = require("uuid");

// Append an audit row to pre_order_status_history (within the caller's transaction).
const recordPreOrderStatusHistory = async (client, { pre_order_oid, from_status, to_status, reason = null, user_id }) => {
    await client.query({
        text: `INSERT INTO ${TABLE.PRE_ORDER_STATUS_HISTORY}
                   (oid, pre_order_oid, from_status, to_status, reason, performed_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
        values: [uuidv4(), pre_order_oid, from_status, to_status, reason, user_id],
    });
};

// Pre-order number: PRE-YYMMDD-NNNN, counted over `pre_orders` only. It must never
// draw from the order invoice sequence -- a booking is not a sale and must not
// consume a daily sale number.
// `runner` is get_data (default) or a bound client.query wrapper.
const nextPreOrderNo = async (runner) => {
    const rows = await runner({
        text: `SELECT COUNT(*)::int AS today_count FROM ${TABLE.PRE_ORDERS} WHERE created_on::date = CURRENT_DATE`,
        values: [],
    });
    const count = rows?.[0]?.today_count ?? 0;
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const seq = String(count + 1).padStart(4, "0");
    return `PRE-${yy}${mm}${dd}-${seq}`;
};

// Per-product SELLABLE stock (on-hand minus active holds) for `for_sale` batches
// that are `ready_for_sale`. Used by stock readiness and the ready-to-convert
// queue. Returned as a CTE body so callers can compose it.
const SELLABLE_BY_PRODUCT_CTE = `
    SELECT i.product_oid,
           SUM(i.quantity_available - COALESCE(h.held, 0))::int AS sellable_quantity
      FROM ${TABLE.INVENTORY} i
      LEFT JOIN (
            SELECT inventory_oid, SUM(quantity)::int AS held
              FROM ${TABLE.STOCK_HOLD}
             WHERE status = 'Active'
             GROUP BY inventory_oid
      ) h ON h.inventory_oid = i.oid
     WHERE i.intended_use = 'for_sale'
       AND i.status = 'ready_for_sale'
     GROUP BY i.product_oid
`;

// A pre-order is "open" while it can still become an order.
const OPEN_STATUSES = ["Pending", "Confirmed"];

module.exports = { recordPreOrderStatusHistory, nextPreOrderNo, SELLABLE_BY_PRODUCT_CTE, OPEN_STATUSES };
