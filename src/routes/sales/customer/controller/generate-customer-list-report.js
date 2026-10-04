const ExcelJS = require("exceljs");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { addReportHeader } = require("../../../../utils/report-header");
const { business_zone, format_business, zone_label } = require("../../../../utils/business-time");
const { send_workbook, fit_columns } = require("../../../inventory/utils/report");
const { LIST, AGE_BAND_LABEL } = require("../utils/customer-list");

const EVERY_ROW = 100000;

// The customers list as the person filtered it (sales REQ-68), every page at once.
const generate_customer_list_report = async (request, res) => {
    try {
        const [{ rows }, zone] = await Promise.all([read_list({ ...LIST, query: { ...request.query, offset: 0, limit: EVERY_ROW } }), business_zone()]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Customers");
        const titles = ["Name", "Phone", "Gender", "Age", "Flag", "Flag reason", "First source", "District", "Thana or upazila", "Address", "Status", "Added"];
        addReportHeader(sheet, "Customers", titles.length);
        sheet.addRow(titles).font = { bold: true };
        for (const c of rows) {
            sheet.addRow([c.name, c.phone ?? "", c.gender ?? "Not known", AGE_BAND_LABEL[c.age_band] ?? "Not known", c.flag, c.flag_reason ?? "", c.first_source_name ?? "", c.district_name_en ?? "", c.thana_name_en ?? "", c.address_line ?? "", c.status, format_business(c.created_on, zone)]);
        }
        sheet.addRow([]);
        sheet.addRow(["Times", zone_label(zone)]).getCell(1).font = { bold: true };
        fit_columns(sheet);

        return send_workbook(res, workbook, "Customers.xlsx");
    } catch (e) {
        log.error(`An exception occurred while building the customers download: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not build the download. Try again in a moment." });
    }
};

module.exports = generate_customer_list_report;
