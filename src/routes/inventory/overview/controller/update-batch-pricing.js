const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// The price applies to sales made after it: an order line stores its own unit price. Only a batch for
// sale takes a price. The old endpoint set any batch it was given to ready_for_sale, so a batch of
// packaging (internal use) became sellable at the counter.
const update_batch_pricing = async (request, res) => {
      const { inventory_oid, selling_price, maximum_discount } = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [batch] = await tx.get_data({
                        text: `SELECT i.batch_code, i.intended_use, i.status, i.product_oid, p.name AS product_name,
                                      i.selling_price::bigint AS selling_price, i.maximum_discount::bigint AS maximum_discount
                                 FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                                WHERE i.oid = $1
                                  FOR UPDATE OF i`,
                        values: [inventory_oid],
                  });
                  if (!batch) fail(404, "That batch no longer exists.");
                  if (batch.intended_use !== "for_sale") fail(409, `Batch ${batch.batch_code} is for internal use, so it has no selling price.`, { reason: "internal_use" });
                  if (batch.status === "ready_for_sale" && Number(batch.selling_price) === selling_price && Number(batch.maximum_discount ?? 0) === maximum_discount) {
                        changed = false;
                        return;
                  }

                  await tx.execute_value({
                        text: `UPDATE ${TABLE.INVENTORY} SET selling_price = $1, maximum_discount = $2, status = 'ready_for_sale', edited_by = $3, edited_on = clock_timestamp() WHERE oid = $4`,
                        values: [selling_price, maximum_discount, user_id, inventory_oid],
                  });

                  const before = batch.selling_price === null ? "no price" : `${batch.selling_price}, up to ${batch.maximum_discount ?? 0} off`;
                  await saveLogActivity(
                        {
                              reference_type: "product-stock",
                              reference_oid: batch.product_oid,
                              title: "Price changed",
                              description: `${batch.product_name}, batch ${batch.batch_code}: ${before} to ${selling_price}, up to ${maximum_discount} off`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while changing the price of batch ${inventory_oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the price. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
      return res.status(200).json({ code: 200, message: "Price saved", data: { changed: true } });
};

module.exports = update_batch_pricing;
