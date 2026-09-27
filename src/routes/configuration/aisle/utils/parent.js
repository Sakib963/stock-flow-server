const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

/**
 * Locks the warehouse and refuses one that is missing or Inactive, for the request written by hand:
 * the form's picker lists Active warehouses only. The lock keeps it from turning Inactive meanwhile.
 */
const require_active_warehouse = async (tx, warehouse_oid) => {
      const rows = await tx.get_data({ text: `SELECT status FROM ${TABLE.WAREHOUSE} WHERE oid = $1 FOR SHARE`, values: [warehouse_oid] });
      if (!rows.length || rows[0].status !== "Active") fail(400, "Pick an active warehouse for this aisle.", { field: "warehouse_oid" });
};

/**
 * Refuses moving an aisle that has ever received stock to another warehouse.
 *
 * Each purchase order line records its warehouse and its aisle together. Moving the aisle would leave
 * those lines naming one warehouse and an aisle in another, and every stock number by location would
 * disagree with itself.
 */
const refuse_move_with_stock = async (tx, aisle_oid) => {
      const rows = await tx.get_data({ text: `SELECT 1 FROM ${TABLE.PURCHASE_DETAILS} WHERE aisle_oid = $1 LIMIT 1`, values: [aisle_oid] });
      if (rows.length) fail(400, "Stock has been received into this aisle, so it cannot move to another warehouse.", { field: "warehouse_oid", reason: "has_stock" });
};

module.exports = { require_active_warehouse, refuse_move_with_stock };
