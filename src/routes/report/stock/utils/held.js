const { TABLE } = require("../../../../utils/constant");

const HELD = `(SELECT inventory_oid, SUM(quantity) AS held FROM ${TABLE.STOCK_HOLD} WHERE status = 'Active' GROUP BY inventory_oid)`;

module.exports = { HELD };
