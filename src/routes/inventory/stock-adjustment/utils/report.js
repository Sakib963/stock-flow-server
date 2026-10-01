// A timestamp without a zone is read by pg as local time, so its local parts are the day as stored.
const stored_day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const fit_columns = (sheet) =>
      sheet.columns.forEach((column) => {
            let widest = 0;
            column.eachCell({ includeEmpty: false }, (cell) => (widest = Math.max(widest, cell.value?.toString().length ?? 0)));
            column.width = Math.min(Math.max(widest + 1, 10), 40);
      });

const send_workbook = async (res, workbook, file_name) => {
      const buffer = await workbook.xlsx.writeBuffer();
      const encoded = encodeURIComponent(file_name);
      return res
            .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .set("Content-Disposition", `attachment; filename="${file_name.replace(/[^\x00-\x7F]/g, "")}"; filename*=UTF-8''${encoded}`)
            .set("X-Filename", encoded)
            .set("Access-Control-Expose-Headers", "X-Filename")
            .set("Content-Length", buffer.length)
            .send(buffer);
};

module.exports = { stored_day, fit_columns, send_workbook };
