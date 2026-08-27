// -----------------------------------------------------------------------------
// Shared helpers for the Returns feature.
//
// Every helper takes the `tx` handle from `execute_transaction` so it composes
// inside the caller's single transaction. Nothing here opens a connection.
// -----------------------------------------------------------------------------
const { TABLE } = require("./constant");

// The order states a return can be raised against (D6). A POS sale realizes at
// Purchased and an online sale at Delivered; PartiallyReturned means an earlier
// return already took some units but more can still come back.
const RETURNABLE_ORDER_STATUS = ["Purchased", "Delivered", "PartiallyReturned"];

// Per-unit refund for an order line. The line total at sale time was
// (unit_price - discount) * quantity, where `discount` is a PER-UNIT amount, so
// refunding unit_price alone would pay back more than the customer ever paid.
const refundPerUnit = (line) => Math.max(0, Number(line.unit_price || 0) - Number(line.discount || 0));

// Units of each order line already claimed by a return that has not moved stock
// yet. Returns Map<order_item_oid, qty>.
//
// This is what stops two open returns claiming the same unit: `returned_qty` only
// counts confirmed returns, so without this a second Pending return could be
// raised for stock the first one is already about to take back.
const getPendingReturnQty = async (tx, order_oid) => {
    const rows = await tx.get_data({
        text: `SELECT rd.order_item_oid, COALESCE(SUM(rd.return_quantity), 0)::int AS pending_qty
                 FROM ${TABLE.RETURN_DETAILS} rd
                 JOIN ${TABLE.PRODUCT_RETURN} pr ON pr.oid = rd.return_oid
                WHERE pr.order_oid = $1 AND pr.status = 'Pending'
                GROUP BY rd.order_item_oid`,
        values: [order_oid],
    });
    return new Map(rows.map((r) => [r.order_item_oid, Number(r.pending_qty)]));
};

// Money already committed to the customer by earlier returns on this order.
// Pending returns count: their refund is not settled yet, but it is spoken for,
// so a second open return must not promise the same money twice.
const getCommittedRefund = async (tx, order_oid) => {
    const rows = await tx.get_data({
        text: `SELECT COALESCE(SUM(refund_amount), 0)::int AS committed
                 FROM ${TABLE.PRODUCT_RETURN}
                WHERE order_oid = $1 AND status IN ('Pending', 'Returned', 'Completed')`,
        values: [order_oid],
    });
    return Number(rows[0].committed);
};

// What the customer has actually handed over, derived from payment_status rather
// than read straight off amount_paid.
//
// amount_paid is not maintained everywhere: POS checkout never writes it, and
// some online orders sit at payment_status 'paid' with amount_paid still 0. Taking
// it literally would cap a refund at zero on a fully paid sale. payment_status is
// the field every intake path does set, so it is the one to trust, and amount_paid
// is only consulted for the partial case where it is the sole source of the number.
const effectiveAmountPaid = ({ payment_status, total_amount, amount_paid }) => {
    if (payment_status === "paid") return Number(total_amount || 0);
    if (payment_status === "partially_paid") return Number(amount_paid || 0);
    return 0;
};

// Split the value of returned goods into money owed back and money never paid.
//
// A return is worth what the customer was charged for it, but the shop can only
// refund what it actually received. On an unpaid or partly paid order the rest of
// the value is not a refund at all: it simply reduces what the customer still
// owes. Refunding it would hand back money that never arrived.
const splitReturnValue = ({ return_value, amount_paid, already_committed }) => {
    const refundable = Math.max(0, Number(amount_paid || 0) - Number(already_committed || 0));
    const refund_due = Math.max(0, Math.min(return_value, refundable));
    return { return_value, refund_due, due_reduction: return_value - refund_due };
};

// Next return reference for an order: <invoice_no>-R<n>.
// Counts EVERY prior return including cancelled ones, so a reference is never
// reused and the sequence reads as the order's return history.
const nextReturnNo = async (tx, { order_oid, invoice_no }) => {
    const rows = await tx.get_data({
        text: `SELECT COUNT(*)::int AS n FROM ${TABLE.PRODUCT_RETURN} WHERE order_oid = $1`,
        values: [order_oid],
    });
    return `${invoice_no}-R${rows[0].n + 1}`;
};

module.exports = { RETURNABLE_ORDER_STATUS, refundPerUnit, getPendingReturnQty, getCommittedRefund, effectiveAmountPaid, splitReturnValue, nextReturnNo };
