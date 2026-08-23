const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

// Export the whole pre-order book: every booking, plus an advance-liability
// summary (FR-38) and the demand-by-product roll-up that says what to reorder.
const export_pre_order_data = async (request, res) => {
    try {
        const [preOrders, demand, liability] = await Promise.all([get_data(generate_pre_orders_sql()), get_data(generate_demand_sql()), get_data(generate_liability_sql())]);

        const buffer = await generate_export_xlsx(preOrders, demand, liability.length ? liability[0] : {});
        const timestamp = Date.now();
        const file_name = `pre_orders_export_${timestamp}.xlsx`;
        const file_name_encoded = encodeURIComponent(file_name);

        log.info(`Pre-order export generated: ${preOrders.length} booking(s) - [${file_name}]`);

        res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .set("Content-Disposition", `attachment; filename="${file_name}"; filename*=UTF-8''${file_name_encoded}`)
            .set("X-Filename", file_name_encoded)
            .set("Access-Control-Expose-Headers", "X-Filename")
            .set("Content-Length", buffer.length)
            .send(buffer);
    } catch (e) {
        log.error(`An exception occurred while exporting pre-order data: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
    }
};

const generate_pre_orders_sql = () => ({
    text: `
        SELECT po.preorder_no, po.customer_name, po.customer_phone, po.status,
               po.expected_date, po.created_on,
               CAST(po.total_amount AS INTEGER) AS total_amount,
               CAST(po.advance_paid AS INTEGER) AS advance_paid,
               CAST(po.advance_refunded AS INTEGER) AS advance_refunded,
               CAST(po.total_amount - po.advance_paid AS INTEGER) AS balance_due,
               COUNT(poi.oid) AS item_count,
               o.invoice_no AS converted_invoice_no
          FROM ${TABLE.PRE_ORDERS} po
          LEFT JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
          LEFT JOIN ${TABLE.ORDERS} o ON o.oid = po.converted_order_oid
         GROUP BY po.oid, o.invoice_no
         ORDER BY po.created_on DESC
    `,
    values: [],
});

// What to reorder: open demand per product against what is sellable right now.
const generate_demand_sql = () => ({
    text: `
        WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE})
        SELECT poi.product_name,
               SUM(poi.quantity)::int AS units_pre_ordered,
               COUNT(DISTINCT po.oid) AS booking_count,
               COALESCE(MAX(s.sellable_quantity), 0) AS sellable_quantity,
               GREATEST(SUM(poi.quantity) - COALESCE(MAX(s.sellable_quantity), 0), 0)::int AS shortfall
          FROM ${TABLE.PRE_ORDERS} po
          JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
          LEFT JOIN sellable s ON s.product_oid = poi.product_oid
         WHERE po.status IN ('Pending', 'Confirmed')
         GROUP BY poi.product_oid, poi.product_name
         ORDER BY shortfall DESC, units_pre_ordered DESC
    `,
    values: [],
});

const generate_liability_sql = () => ({
    text: `
        SELECT COUNT(*)::int AS open_count,
               COALESCE(SUM(advance_paid - advance_refunded), 0)::int AS advance_held,
               COALESCE(SUM(total_amount), 0)::int AS open_value,
               COALESCE(SUM(total_amount - advance_paid), 0)::int AS balance_due
          FROM ${TABLE.PRE_ORDERS}
         WHERE status IN ('Pending', 'Confirmed')
    `,
    values: [],
});

const generate_export_xlsx = async (preOrders, demand, liability) => {
    const workbook = new ExcelJS.Workbook();

    const styleHeader = (row) => {
        row.font = { bold: true };
        row.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
        });
    };

    // Sheet 1 -- every booking
    const listSheet = workbook.addWorksheet("Pre-Orders");
    listSheet.columns = [{ width: 20 }, { width: 24 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 20 }];
    addReportHeader(listSheet, "Pre-Order Book", 12);
    listSheet.addRow([]);
    styleHeader(listSheet.addRow(["Pre-Order No", "Customer", "Phone", "Status", "Expected Date", "Booked On", "Total", "Advance", "Refunded", "Balance Due", "Items", "Converted Order"]));
    preOrders.forEach((p) =>
        listSheet.addRow([p.preorder_no, p.customer_name, p.customer_phone, p.status, p.expected_date, p.created_on, p.total_amount, p.advance_paid, p.advance_refunded, p.balance_due, p.item_count, p.converted_invoice_no || "N/A"])
    );

    // Sheet 2 -- the reorder signal
    const demandSheet = workbook.addWorksheet("Demand By Product");
    demandSheet.columns = [{ width: 34 }, { width: 20 }, { width: 16 }, { width: 20 }, { width: 14 }];
    addReportHeader(demandSheet, "Open Pre-Order Demand", 5);
    demandSheet.addRow([]);
    styleHeader(demandSheet.addRow(["Product", "Units Pre-Ordered", "Bookings", "Sellable Now", "Shortfall"]));
    demand.forEach((d) => demandSheet.addRow([d.product_name, d.units_pre_ordered, d.booking_count, d.sellable_quantity, d.shortfall]));

    // Sheet 3 -- money position
    const moneySheet = workbook.addWorksheet("Advance Liability");
    moneySheet.columns = [{ width: 34 }, { width: 20 }];
    addReportHeader(moneySheet, "Advance Liability", 2);
    moneySheet.addRow([]);
    const addPair = (label, value) => {
        const row = moneySheet.addRow([label, value ?? 0]);
        row.getCell(1).font = { bold: true };
    };
    addPair("Open Pre-Orders", liability.open_count);
    addPair("Advance Held (liability)", liability.advance_held);
    addPair("Open Booking Value", liability.open_value);
    addPair("Balance Due From Customers", liability.balance_due);

    const note = moneySheet.addRow(["Advance held is money taken against bookings that are not yet sales. It is a liability until each pre-order converts and the resulting order realises, and must never be counted as revenue."]);
    note.font = { italic: true, size: 10 };
    moneySheet.mergeCells(`A${note.number}:B${note.number}`);

    return await workbook.xlsx.writeBuffer();
};

module.exports = export_pre_order_data;
