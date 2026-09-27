const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { duplicate_conflict, already_written } = require("../utils/duplicate");
const { require_active_sub_category, require_active_brand } = require("../utils/parents");
const { first_free_sku } = require("../utils/sku");
const { v4: uuidv4 } = require("uuid");

const create_product = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const productOid = uuidv4();

      try {
            await execute_transaction(async (tx) => {
                  const category_oid = await require_active_sub_category(tx, payload.sub_category_oid);
                  if (payload.brand_oid) await require_active_brand(tx, payload.brand_oid);

                  const sku = payload.sku ?? (await first_free_sku(tx.get_data, payload.name));
                  if (!sku) fail(400, "No SKU could be made from this name. Type one yourself.", { field: "sku" });

                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.PRODUCT} (oid, name, sku, category_oid, sub_category_oid, brand_oid, unit_type, description, photo, restock_threshold, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                        values: [productOid, payload.name, sku, category_oid, payload.sub_category_oid, payload.brand_oid, payload.unit_type, payload.description, payload.photo, payload.restock_threshold, payload.status, user_id],
                  });
                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.PRODUCT_STATS} (oid, product_oid) VALUES ($1, $2)`,
                        values: [uuidv4(), productOid],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "product",
                              reference_oid: productOid,
                              title: "Created product",
                              description: `Created product "${payload.name}" with SKU ${sku}`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            if (already_written(e)) {
                  log.info(`Product ${payload.name} was already created by an earlier attempt of this request`);
                  return res.status(200).json({ code: 200, message: "Product Created Successfully!", data: { oid: productOid } });
            }

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Product not created, ${conflict.field} already taken by another product`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }
            log.error(`An exception occurred while creating product: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.name} created successfully by: ${user_id}`);
      return res.status(200).json({ code: 200, message: "Product Created Successfully!", data: { oid: productOid } });
};

module.exports = create_product;
