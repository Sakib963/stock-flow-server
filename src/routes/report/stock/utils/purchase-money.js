const { TABLE } = require("../../../../utils/constant");

// A received purchase order's money as supplier-stats reads it: on the total the owner recorded, paid
// decided by payment_status, owed the rest. Paid is as at now, so a closed month can change.
const PURCHASE_MONEY = (where) => `
    SELECT pu.oid, pu.po_number, pu.verified_on, su.name AS supplier, pu.payment_status, pu.total_amount AS total,
           CASE pu.payment_status WHEN 'paid' THEN pu.total_amount WHEN 'partially_paid' THEN COALESCE(pu.paid_amount, 0) ELSE 0 END AS paid,
           (SELECT COALESCE(SUM(d.verified_quantity), 0) FROM ${TABLE.PURCHASE_DETAILS} d WHERE d.purchase_oid = pu.oid) AS units
      FROM ${TABLE.PURCHASE} pu
      JOIN ${TABLE.SUPPLIER} su ON su.oid = pu.supplier_oid
     WHERE pu.status = 'Verified' AND ${where}`;

module.exports = { PURCHASE_MONEY };
