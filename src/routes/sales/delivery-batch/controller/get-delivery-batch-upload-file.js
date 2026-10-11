const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { READY, ORDER_COLUMNS, ORDER_FROM, pathaoCsv } = require("../utils/batch-orders");

// The courier's upload file (REQ-05, REQ-06). It changes nothing, so it can be downloaded again. Only
// parcels still going with this batch are in it: before handover the orders still ready to send, after it
// the ones still with the courier. A cancelled one, or one sent another way, must not be booked twice.
const get_delivery_batch_upload_file = async (request, res) => {
    const { oid } = request.params;
    try {
        const [batch] = await get_data({ text: `SELECT batch_no, courier, status FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1`, values: [oid] });
        if (!batch) return res.status(404).json({ code: 404, message: "No delivery batch with that number." });
        if (batch.status === "Cancelled") return res.status(409).json({ code: 409, message: `${batch.batch_no} is cancelled, so it has no file to send.`, data: { status: batch.status } });
        if (batch.courier !== "Pathao") return res.status(400).json({ code: 400, message: `Only Pathao's upload file can be made so far, and ${batch.batch_no} is for ${batch.courier}.` });
        const orders = await get_data({
            text: `SELECT ${ORDER_COLUMNS} FROM ${TABLE.DELIVERY_BATCH_ORDER} bo JOIN ${ORDER_FROM} ON o.oid = bo.order_oid
                    WHERE bo.batch_oid = $1 AND bo.active AND ${batch.status === "Open" ? READY : `(o.status = 'Confirmed' AND oo.delivery_status = 'WithCourier')`} ORDER BY o.created_on, o.oid`,
            values: [oid],
        });
        const name = `${batch.batch_no}-pathao.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
        res.setHeader("X-Filename", encodeURIComponent(name));
        res.setHeader("Access-Control-Expose-Headers", "X-Filename");
        return res.status(200).send(pathaoCsv(orders));
    } catch (e) {
        log.error(`An exception occurred while making the upload file of delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not make the upload file. Try again in a moment." });
    }
};

module.exports = get_delivery_batch_upload_file;
