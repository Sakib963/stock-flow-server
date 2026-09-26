const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

/**
 * Locks the parent category and refuses one that is missing or Inactive.
 *
 * Inactive is refused because it means "stop offering this": the form's picker lists Active
 * categories only, so this is for the request written by hand. The lock keeps the category from
 * being turned Inactive between this check and the write.
 */
const require_active_parent = async (tx, category_oid) => {
      const rows = await tx.get_data({ text: `SELECT status FROM ${TABLE.CATEGORIES} WHERE oid = $1 FOR SHARE`, values: [category_oid] });
      if (!rows.length || rows[0].status !== "Active") fail(400, "Pick an active category for this sub-category.", { field: "category_oid" });
};

module.exports = { require_active_parent };
