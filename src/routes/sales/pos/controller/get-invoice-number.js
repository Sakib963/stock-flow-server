const { get_data } = require("../../../../utils/database");
const { nextInvoiceNo } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Suggest the next order/invoice number for a new POS sale.
const get_invoice_number = async (request, res) => {
    try {
        const invoice_no = await nextInvoiceNo(get_data);
        log.info(`Generated order invoice number: ${invoice_no}`);
        return res.status(200).json({ code: 200, message: "Invoice number found", data: { invoice_no } });
    } catch (e) {
        log.error(`An exception occurred while generating invoice number: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_invoice_number;
