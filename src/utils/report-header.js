const path = require("path");

const addReportHeader = (sheet, reportTitle, columnCount) => {
      // Logo
      const logoPath = path.resolve("./src/assets/logo.png");
      const logoId = sheet.workbook.addImage({
            filename: logoPath,
            extension: "png",
      });
      sheet.mergeCells("A1:A2");
      sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 150, height: 120 },
      });

      const lastCol = sheet.getColumn(columnCount).letter;

      // Company Name
      sheet.mergeCells(`B1:${lastCol}1`);
      sheet.getCell("B1").value = "StockFlow";
      sheet.getCell("B1").font = { bold: true, size: 14 };
      sheet.getCell("B1").alignment = { vertical: "middle", horizontal: "center" };

      // Company Address
      sheet.mergeCells(`B2:${lastCol}2`);
      sheet.getCell("B2").value =
            "123 StockFlow Street, Inventory City, Supply State.";
      sheet.getCell("B2").font = { size: 11 };
      sheet.getCell("B2").alignment = { vertical: "middle", horizontal: "center", wrapText: true };

      sheet.getRow(1).height = 60;
      sheet.getRow(2).height = 40;

      // Report Title
      sheet.mergeCells(`B4:${lastCol}4`);
      const titleCell = sheet.getCell("B4");
      titleCell.value = reportTitle;
      titleCell.font = { size: 14, bold: true };
      titleCell.alignment = { vertical: "middle", horizontal: "center" };
      sheet.getRow(4).height = 30;

      return sheet;
};

module.exports = { addReportHeader };
