const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { run_report, ROW_LIMIT } = require("./run-report");
const { write_workbook } = require("./write-workbook");
const { LABELS } = require("./labels");

// What stops a report before it is sent, as the answer the person reads.
const refusal = (result) => {
    if (result.forbidden) return { status: 403, message: "This report shows buying prices, which your role does not include." };
    if (result.too_long) return { status: 400, message: "Choose a period of a year or less." };
    if (result.too_many) return { status: 400, message: `More than ${ROW_LIMIT.toLocaleString("en")} rows. Choose a shorter period or a narrower filter.` };
    return null;
};

const FILTER_NAMES_SQL = `
    SELECT (SELECT name FROM ${TABLE.CATEGORIES} WHERE oid = $1) AS category,
           (SELECT name FROM ${TABLE.WAREHOUSE} WHERE oid = $2) AS warehouse,
           (SELECT name FROM ${TABLE.SUPPLIER} WHERE oid = $3) AS supplier`;

// The filters a download was made with, by name, printed under its title (REQ-18).
const describe_filters = async (query) => {
    const [names] = await get_data({ text: FILTER_NAMES_SQL, values: [query.category_oid ?? null, query.warehouse_oid ?? null, query.supplier_oid ?? null] });
    const reason = query.reason && (LABELS.dispose_reason[query.reason] ?? LABELS.adjustment_reason[query.reason] ?? query.reason);
    return [
        ["Channel", query.channel && LABELS.channel[query.channel]],
        ["Category", names.category],
        ["Warehouse", names.warehouse],
        ["Supplier", names.supplier],
        ["Reason", reason],
        ["Expires within", query.within_days && `${query.within_days} days`],
    ].filter(([, value]) => value);
};

const send_report = async (reports, request, res) => {
    const key = request.query.report;
    try {
        const result = await run_report(reports[key], request);
        const refused = refusal(result);
        if (refused) return res.status(refused.status).json({ code: refused.status, message: refused.message });
        return res.status(200).json({
            code: 200,
            message: result.title,
            // Every row is read for the totals; the screen gets the page it asked for, cut from the same
            // result so a sale landing between pages cannot make a page disagree with the totals.
            data: { ...result, rows: result.rows.slice(request.query.offset, request.query.offset + request.query.limit), row_count: result.rows.length },
        });
    } catch (e) {
        log.error(`An exception occurred while running the ${key} report: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not run the report. Try again in a moment." });
    }
};

const send_report_workbook = async (reports, request, res) => {
    const key = request.query.report;
    try {
        const result = await run_report(reports[key], request);
        const refused = refusal(result);
        if (refused) return res.status(refused.status).json({ code: refused.status, message: refused.message });
        const filters = await describe_filters(request.query);
        const file_name = `${result.title}${result.period ? ` ${result.period.date_from} to ${result.period.date_to}` : ""}.xlsx`;
        return await write_workbook(res, result, { filters, file_name, request });
    } catch (e) {
        log.error(`An exception occurred while building the ${key} report: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not build the report. Try again in a moment." });
    }
};

module.exports = { send_report, send_report_workbook };
