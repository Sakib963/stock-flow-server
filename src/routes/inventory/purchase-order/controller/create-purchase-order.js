const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { taka, order_total, resolve_paid, draft_paid, check_references, insert_lines } = require("../utils/order-rules");
const { v4: uuidv4 } = require("uuid");
const { business_number } = require("../../../../utils/business-time");

const create_purchase_order = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const purchase_oid = uuidv4();

      try {
            const { po_number, status } = await execute_transaction(async (tx) => {
                  await check_references(tx, payload);

                  const total_amount = order_total(payload.products);
                  const paid_amount = payload.draft ? draft_paid(payload, total_amount) : resolve_paid(payload, total_amount);
                  const status = payload.draft ? "Draft" : "Submitted";

                  const [created] = (
                        await tx.execute_value({
                              text: `INSERT INTO ${TABLE.PURCHASE} (oid, po_number, supplier_oid, total_amount, special_notes, payment_status, paid_amount, purchase_type, expected_delivery_date, status, created_by)
                                     VALUES ($1, ${business_number("PO", "purchase_po_number_seq")}, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING po_number`,
                              values: [purchase_oid, payload.supplier_oid, total_amount, payload.special_notes, payload.payment_status, paid_amount, payload.purchase_type, payload.expected_delivery_date, status, user_id],
                        })
                  ).rows;

                  await insert_lines(tx, purchase_oid, payload.products, uuidv4);

                  await saveLogActivity(
                        {
                              reference_type: "purchase-order",
                              reference_oid: purchase_oid,
                              title: payload.draft ? "Saved as draft" : "Raised and submitted",
                              description: `${created.po_number}: ${payload.products.length} product${payload.products.length === 1 ? "" : "s"}, total ${taka(total_amount)}${payload.payment_status ? `, ${payload.payment_status.replace("_", " ")}` : ""}${payload.payment_status === "partially_paid" ? ` ${taka(paid_amount)}` : ""}`,
                        },
                        { tx, request }
                  );

                  return { po_number: created.po_number, status };
            });

            log.info(`Purchase order ${po_number} created by ${user_id}`);
            return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Purchase order submitted", data: { oid: purchase_oid, po_number, status } });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while creating a purchase order: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the purchase order. Try again in a moment." });
      }
};

module.exports = create_purchase_order;
