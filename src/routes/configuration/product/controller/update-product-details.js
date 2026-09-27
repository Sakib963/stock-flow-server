const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");
const { require_active_sub_category, require_active_brand } = require("../utils/parents");
const { first_free_sku } = require("../utils/sku");

const NOT_FOUND = "That product no longer exists. It may have been deleted.";

const update_product_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, sku, category_oid, sub_category_oid, brand_oid, unit_type, description, photo, restock_threshold::int AS restock_threshold, status
                               FROM ${TABLE.PRODUCT} WHERE oid = $1 AND is_deleted = FALSE FOR UPDATE`,
                        values: [payload.oid],
                  });
                  if (!rows.length) fail(404, NOT_FOUND);
                  const current = rows[0];

                  // A parent that has since been turned Inactive does not block saving the product
                  // under it; only a newly picked one has to be Active.
                  const category_oid = current.sub_category_oid === payload.sub_category_oid ? current.category_oid : await require_active_sub_category(tx, payload.sub_category_oid);
                  if (payload.brand_oid && payload.brand_oid !== current.brand_oid) await require_active_brand(tx, payload.brand_oid);

                  const sku = payload.sku ?? (await first_free_sku(tx.get_data, payload.name, payload.oid));
                  if (!sku) fail(400, "No SKU could be made from this name. Type one yourself.", { field: "sku" });

                  // Saving an untouched form writes nothing, so the timeline records only real changes.
                  const changes = detectChanges(current, { ...payload, sku }, { sub_category_oid: "Sub-category", brand_oid: "Brand", unit_type: "Unit", restock_threshold: "Restock level", sku: "SKU" });
                  if (!changes.length) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.PRODUCT} SET name = $1, sku = $2, category_oid = $3, sub_category_oid = $4, brand_oid = $5, unit_type = $6, description = $7, photo = $8, restock_threshold = $9, status = $10, edited_on = clock_timestamp(), edited_by = $11 WHERE oid = $12 AND is_deleted = FALSE`,
                        values: [payload.name, sku, category_oid, payload.sub_category_oid, payload.brand_oid, payload.unit_type, payload.description, payload.photo, payload.restock_threshold, payload.status, user_id, payload.oid],
                  });
                  if (updated.rowCount !== 1) fail(404, NOT_FOUND);

                  await saveLogActivity(
                        {
                              reference_type: "product",
                              reference_oid: payload.oid,
                              title: "Updated product",
                              description: generateChangeDescription(`product "${payload.name}"`, changes),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Product not updated, ${conflict.field} already taken by another product`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating product: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Product ${payload.name} updated successfully by: ${user_id}`);
      return res.status(200).json({ code: 200, message: "Product Updated Successfully!" });
};

module.exports = update_product_details;
