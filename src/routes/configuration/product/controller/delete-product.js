const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");

// Deleting only hides a product; its orders, batches and history stay. So a product still holding
// stock, or promised to an undispatched online order, is refused: deleted, those units and that
// promise would vanish from every list while the stock is still on the shelf. A submitted purchase
// order is refused too: verifying it later would put stock on a product nobody can see.
const delete_product = async (request, res) => {
      const { oid } = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({ text: `SELECT name FROM ${TABLE.PRODUCT} WHERE oid = $1 AND is_deleted = FALSE FOR UPDATE`, values: [oid] });
                  if (!rows.length) fail(404, "That product no longer exists. It may have been deleted already.");

                  const [stock] = await tx.get_data({
                        text: `SELECT (SELECT COALESCE(SUM(quantity_available), 0)::int FROM ${TABLE.INVENTORY} WHERE product_oid = $1) AS on_hand,
                                      (SELECT COALESCE(SUM(quantity), 0)::int FROM ${TABLE.STOCK_HOLD} WHERE product_oid = $1 AND status = 'Active') AS held,
                                      (SELECT COUNT(DISTINCT pd.purchase_oid)::int FROM ${TABLE.PURCHASE_DETAILS} pd JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid WHERE pd.product_oid = $1 AND pu.status = 'Submitted') AS on_order`,
                        values: [oid],
                  });
                  if (stock.held > 0) fail(409, `This product is promised to online orders (${stock.held} units). Deliver or cancel them first, or set the product Inactive.`, { reason: "held", held: stock.held });
                  if (stock.on_order > 0) fail(409, `This product is on ${stock.on_order} purchase order(s) not yet received. Receive or cancel them first, or set the product Inactive.`, { reason: "on_order", on_order: stock.on_order });
                  if (stock.on_hand > 0) fail(409, `This product still has ${stock.on_hand} units in stock. Dispose of them first, or set the product Inactive.`, { reason: "in_stock", on_hand: stock.on_hand });

                  await tx.execute_value({
                        text: `UPDATE ${TABLE.PRODUCT} SET is_deleted = TRUE, deleted_on = clock_timestamp(), deleted_by = $2 WHERE oid = $1`,
                        values: [oid, user_id],
                  });
                  await saveLogActivity(
                        {
                              reference_type: "product",
                              reference_oid: oid,
                              title: "Deleted product",
                              description: `Deleted product "${rows[0].name}"`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while deleting product: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${oid} deleted by: ${user_id}`);
      return res.status(200).json({ code: 200, message: "Product deleted." });
};

module.exports = delete_product;
