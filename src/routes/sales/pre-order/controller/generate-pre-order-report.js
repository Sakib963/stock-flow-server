const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

// Single pre-order report: the booking, its lines, and the money position.
// Advance held is labelled a LIABILITY, not revenue (FR-20/FR-38) -- this money
// is not a sale until the booking converts and the resulting order realises.
const generate_pre_order_report = async (request, res) => {
    try {
        const preOrderOid = request.body.oid;

        if (!preOrderOid) {
            log.warn("Pre-order OID is required");
            return res.status(400).json({ code: 400, message: "Pre-order OID is required", data: null });
        }

        const details_set = await get_data({
            text: `SELECT po.preorder_no, po.customer_name, po.customer_phone, po.customer_email, po.customer_address,
                          po.status, po.expected_date, po.created_on, po.created_by,
                          CAST(po.subtotal AS INTEGER) AS subtotal,
                          CAST(po.discount_total AS INTEGER) AS discount_total,
                          CAST(po.delivery_charge AS INTEGER) AS delivery_charge,
                          CAST(po.total_amount AS INTEGER) AS total_amount,
                          CAST(po.advance_paid AS INTEGER) AS advance_paid,
                          CAST(po.advance_refunded AS INTEGER) AS advance_refunded,
                          po.advance_method, po.notes
                     FROM ${TABLE.PRE_ORDERS} po WHERE po.oid = $1`,
            values: [preOrderOid],
        });

        if (!details_set.length) {
            log.info(`No pre-order found for OID: ${preOrderOid}`);
            return res.status(404).json({ code: 404, message: "Pre-order not found", data: null });
        }

        const details = details_set[0];

        const items = await get_data({
            text: `SELECT product_name,
                          CAST(quantity AS INTEGER) AS quantity,
                          CAST(unit_price AS INTEGER) AS unit_price,
                          CAST(COALESCE(discount, 0) AS INTEGER) AS discount,
                          CAST(total AS INTEGER) AS total
                     FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1 ORDER BY product_name ASC`,
            values: [preOrderOid],
        });

        const buffer = await generate_report_xlsx(details, items);
        const timestamp = Date.now();
        const file_name = `${details.preorder_no}_report_${timestamp}.xlsx`;
        const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
        const file_name_encoded = encodeURIComponent(file_name);

        log.info(`Pre-order report generated for [${details.preorder_no}] - [${file_name}]`);

        res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .set("Content-Disposition", `attachment; filename="${file_name_ascii}"; filename*=UTF-8''${file_name_encoded}`)
            .set("X-Filename", file_name_encoded)
            .set("Access-Control-Expose-Headers", "X-Filename")
            .set("Content-Length", buffer.length)
            .send(buffer);
    } catch (e) {
        log.error(`An exception occurred while generating pre-order report: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
    }
};

const generate_report_xlsx = async (details, items) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pre-Order");

    sheet.columns = [{ width: 26 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }];

    addReportHeader(sheet, `Pre-Order ${details.preorder_no}`, 5);

    const addSectionTitle = (title) => {
        const row = sheet.addRow([title]);
        row.font = { bold: true, size: 12 };
        sheet.mergeCells(`A${row.number}:E${row.number}`);
    };

    const addPair = (label, value) => {
        const row = sheet.addRow([label, value ?? "N/A"]);
        row.getCell(1).font = { bold: true };
    };

    sheet.addRow([]);
    addSectionTitle("Booking");
    addPair("Pre-Order No", details.preorder_no);
    addPair("Status", details.status);
    addPair("Booked On", details.created_on);
    addPair("Booked By", details.created_by);
    addPair("Expected Availability", details.expected_date);
    addPair("Notes", details.notes);

    sheet.addRow([]);
    addSectionTitle("Customer");
    addPair("Name", details.customer_name);
    addPair("Phone", details.customer_phone);
    addPair("Email", details.customer_email);
    addPair("Address", details.customer_address);

    sheet.addRow([]);
    addSectionTitle("Items");
    const header = sheet.addRow(["Product", "Quantity", "Unit Price", "Discount", "Line Total"]);
    header.font = { bold: true };
    header.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });
    items.forEach((i) => sheet.addRow([i.product_name, i.quantity, i.unit_price, i.discount, i.total]));

    sheet.addRow([]);
    addSectionTitle("Money");
    addPair("Subtotal", details.subtotal);
    addPair("Discount", details.discount_total);
    addPair("Delivery Charge", details.delivery_charge);
    addPair("Total", details.total_amount);
    addPair("Advance Paid", details.advance_paid);
    addPair("Advance Method", details.advance_method);
    addPair("Advance Refunded", details.advance_refunded);
    addPair("Balance Due", Number(details.total_amount) - Number(details.advance_paid));

    const note = sheet.addRow(["Advance held is a LIABILITY, not revenue. It becomes a sale only when this pre-order is converted and the resulting order realises."]);
    note.font = { italic: true, size: 10 };
    sheet.mergeCells(`A${note.number}:E${note.number}`);

    return await workbook.xlsx.writeBuffer();
};

module.exports = generate_pre_order_report;
