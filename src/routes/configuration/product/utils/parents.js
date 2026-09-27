const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

/**
 * Locks the sub-category and its category, refuses either when missing or Inactive, and returns the
 * category, which the product stores beside its sub-category. The lock keeps either from being
 * turned Inactive between this check and the write.
 */
const require_active_sub_category = async (tx, sub_category_oid) => {
      const rows = await tx.get_data({
            text: `SELECT sc.category_oid, sc.status, c.status AS category_status
                   FROM ${TABLE.SUB_CATEGORIES} sc JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid
                   WHERE sc.oid = $1 FOR SHARE`,
            values: [sub_category_oid],
      });
      if (!rows.length || rows[0].status !== "Active" || rows[0].category_status !== "Active") fail(400, "Pick an active sub-category for this product.", { field: "sub_category_oid" });
      return rows[0].category_oid;
};

const require_active_brand = async (tx, brand_oid) => {
      const rows = await tx.get_data({ text: `SELECT status FROM ${TABLE.BRANDS} WHERE oid = $1 FOR SHARE`, values: [brand_oid] });
      if (!rows.length || rows[0].status !== "Active") fail(400, "Pick an active brand for this product, or leave it empty.", { field: "brand_oid" });
};

module.exports = { require_active_sub_category, require_active_brand };
