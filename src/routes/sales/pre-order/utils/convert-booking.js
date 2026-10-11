const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory, OPEN_STATUSES } = require("./pre-order-utils");

// Conversion runs inside the online order's create (REQ-09), so the booking closes exactly when the
// order exists. Locked first: a second Convert waits here, then finds it Converted (REQ-11).
const bookingOf = async (tx, pre_order_oid) => {
    const [booking] = await tx.get_data({
        text: `SELECT oid, preorder_no, status, customer_oid, (advance_paid - advance_refunded)::int AS advance FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
        values: [pre_order_oid],
    });
    if (!booking) fail(404, "No pre-order with that number.", { field: "pre_order_oid" });
    booking.lines = await tx.get_data({ text: `SELECT oid, product_oid, product_name, quantity::int AS quantity FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1`, values: [pre_order_oid] });
    return booking;
};

const lockBooking = async (tx, pre_order_oid) => {
    const booking = await bookingOf(tx, pre_order_oid);
    if (!OPEN_STATUSES.includes(booking.status)) fail(409, `${booking.preorder_no} is already ${booking.status === "Converted" ? "an order" : "cancelled"}, so it cannot become one now.`, { field: "pre_order_oid", status: booking.status });
    return booking;
};

// Every booked line arrives on the order, never fewer units (REQ-08), for the customer who booked,
// and the advance becomes what the order says was paid (REQ-10).
const checkConversion = (booking, { customer_oid, lines, amount_paid, total_amount }) => {
    if (customer_oid !== booking.customer_oid) fail(409, `${booking.preorder_no} was pre-ordered by another customer. Keep the pre-order's phone on the order.`, { field: "customer.phone" });
    for (const booked of booking.lines) {
        const units = lines.filter((line) => line.product_oid === booked.product_oid).reduce((sum, line) => sum + line.quantity, 0);
        if (units < booked.quantity) fail(409, `${booked.product_name} was pre-ordered for ${booked.quantity} and the order has ${units}. Add every pre-ordered unit before creating the order.`, { field: "lines", product_oid: booked.product_oid });
    }
    if (booking.advance > total_amount) fail(409, `The advance of ${booking.advance} on ${booking.preorder_no} is more than this order's total of ${total_amount}. Add the products the customer paid for, or refund part of the advance first.`, { field: "amount_paid" });
    if (amount_paid !== booking.advance) fail(409, `The advance of ${booking.advance} on ${booking.preorder_no} is what this order has been paid, not ${amount_paid}. Take it as the advance, or as prepaid when it covers the total.`, { field: "amount_paid", advance: booking.advance });
};

// Each booked line points at the first order line of its product: the record of what it became.
// Run again after an edit, which writes the order's lines anew.
const linkLines = (tx, booking_oid, order_oid) =>
    tx.execute_value({
        text: `UPDATE ${TABLE.ORDER_ITEMS} oi SET pre_order_item_oid = poi.oid
                 FROM ${TABLE.PRE_ORDER_ITEMS} poi
                WHERE poi.pre_order_oid = $1 AND oi.order_oid = $2 AND oi.product_oid = poi.product_oid
                  AND oi.oid = (SELECT MIN(first.oid) FROM ${TABLE.ORDER_ITEMS} first WHERE first.order_oid = $2 AND first.product_oid = poi.product_oid)`,
        values: [booking_oid, order_oid],
    });

const convertBooking = async (tx, booking, { order_oid, invoice_no, user_id, request }) => {
    await tx.execute_value({ text: `UPDATE ${TABLE.ORDERS} SET pre_order_oid = $1 WHERE oid = $2`, values: [booking.oid, order_oid] });
    await linkLines(tx, booking.oid, order_oid);
    const converted = await tx.execute_value({
        text: `UPDATE ${TABLE.PRE_ORDERS} SET status = 'Converted', converted_on = clock_timestamp(), converted_order_oid = $1, edited_by = $2, edited_on = clock_timestamp()
                WHERE oid = $3 AND status IN ('Pending', 'Confirmed')`,
        values: [order_oid, user_id, booking.oid],
    });
    if (converted.rowCount !== 1) fail(409, `${booking.preorder_no} changed while the order was being made. Reload it and try again.`);
    await recordPreOrderStatusHistory(tx, { pre_order_oid: booking.oid, from_status: booking.status, to_status: "Converted", reason: invoice_no, user_id });
    await saveLogActivity({ reference_type: "pre_order", reference_oid: booking.oid, title: "Pre-order became an order", description: `${booking.preorder_no} is now ${invoice_no}` }, { tx, request });
    await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Made from a pre-order", description: `${invoice_no} from ${booking.preorder_no}` }, { tx, request });
};

module.exports = { bookingOf, lockBooking, checkConversion, convertBooking, linkLines };
