const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Copying a filled message is logged on the order (sales REQ-91), so the record shows it was sent.
const record_message_copied = async (request, res) => {
    const { order_oid, template_oid } = request.body;
    try {
        await execute_transaction(async (tx) => {
            const [order] = await tx.get_data({ text: `SELECT invoice_no FROM ${TABLE.ORDERS} WHERE oid = $1 AND channel = 'ONLINE' AND status <> 'Draft'`, values: [order_oid] });
            const [template] = await tx.get_data({ text: `SELECT name, language FROM ${TABLE.MESSAGE_TEMPLATE} WHERE oid = $1`, values: [template_oid] });
            if (!order || !template) fail(404, "That order or template is no longer there. Reload the page.");
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Message copied", description: `${order.invoice_no}: ${template.name} (${template.language})` }, { tx, request });
        });
        return res.status(200).json({ code: 200, message: "Recorded", data: null });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while recording a copied message: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not record the copied message." });
    }
};

module.exports = record_message_copied;
