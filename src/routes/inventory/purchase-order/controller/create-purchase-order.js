const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, get_data, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { taka, order_total, resolve_paid, draft_paid, check_references, insert_lines } = require("../utils/order-rules");
const { v4: uuidv4 } = require("uuid");
const { business_number } = require("../../../../utils/business-time");

// Only the same request sent again is a repeat: a draft saved, then edited and submitted under the
// same oid after a lost response, must not be answered as submitted.
const answer_repeat = async (purchase_oid, user_id, payload, res) => {
      let order;
      try {
            [order] = await get_data({
                  text: `SELECT po_number, status FROM ${TABLE.PURCHASE} WHERE oid = $1 AND created_by = $2 AND status = $3 AND total_amount = $4`,
                  values: [purchase_oid, user_id, payload.draft ? "Draft" : "Submitted", order_total(payload.products)],
            });
      } catch (e) {
            log.error(`Could not read back purchase order ${purchase_oid} after a repeated create: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the purchase order. Try again in a moment." });
      }
      if (!order) return res.status(409).json({ code: 409, message: "This purchase order could not be saved. Reload the page and try again." });
      log.info(`Purchase order ${order.po_number} was already raised by an earlier attempt of this request`);
      return res.status(200).json({ code: 200, message: order.status === "Draft" ? "Draft saved" : "Purchase order submitted", data: { oid: purchase_oid, po_number: order.po_number, status: order.status } });
};

const create_purchase_order = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const purchase_oid = payload.oid ?? uuidv4();

      try {
            const { po_number, status } = await execute_transaction(async (tx) => {
                  await check_references(tx, payload);

                  const total_amount = order_total(payload.products);
                  const paid_amount = payload.draft ? draft_paid(payload, total_amount) : resolve_paid(payload, total_amount);
                  const status = payload.draft ? "Draft" : "Submitted";

                  const [created] = (
                        await tx.execute_value({
                              text: `INSERT INTO ${TABLE.PURCHASE} (oid, po_number, supplier_oid, total_amount, special_notes, payment_status, paid_amount, purchase_type, expected_delivery_date, status, created_by, submitted_on)
                                     VALUES ($1, ${business_number("PO", "purchase_po_number_seq")}, $2, $3, $4, $5, $6, $7, $8, $9::text, $10, CASE WHEN $9::text = 'Submitted' THEN clock_timestamp() END) RETURNING po_number`,
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
            if (e?.code === "23505" && e.constraint === "purchase_pkey") return answer_repeat(purchase_oid, user_id, payload, res);
            log.error(`An exception occurred while creating a purchase order: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the purchase order. Try again in a moment." });
      }
};

module.exports = create_purchase_order;
