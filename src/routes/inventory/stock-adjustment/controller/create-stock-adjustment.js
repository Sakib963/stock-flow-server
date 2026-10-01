const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { REASON_LABEL, shape_lines, check_lines, insert_lines, units } = require("../utils/adjustment-rules");
const { v4: uuidv4 } = require("uuid");
const { business_number } = require("../../../../utils/business-time");

// Saving moves nothing, as a Draft or as Submitted: stock moves only when someone verifies it, in a
// separate click on the record page (decided 2026-09-30).
const create_stock_adjustment = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const adjustment_oid = uuidv4();

      try {
            const { adjustment_number, status } = await execute_transaction(async (tx) => {
                  const lines = shape_lines(payload.reason, payload.lines);
                  await check_lines(tx, lines, !payload.draft);
                  const status = payload.draft ? "Draft" : "Submitted";

                  const [created] = (
                        await tx.execute_value({
                              text: `INSERT INTO ${TABLE.STOCK_ADJUSTMENT} (oid, adjustment_number, reason, note, status, created_by, submitted_by, submitted_on)
                                     VALUES ($1, ${business_number("ADJ", "stock_adjustment_number_seq")}, $2, $3, $4::varchar, $5, $6, CASE WHEN $4::varchar = 'Submitted' THEN clock_timestamp() END) RETURNING adjustment_number`,
                              values: [adjustment_oid, payload.reason, payload.note, status, user_id, status === "Submitted" ? user_id : null],
                        })
                  ).rows;
                  await insert_lines(tx, adjustment_oid, lines, user_id, uuidv4);

                  await saveLogActivity(
                        {
                              reference_type: "stock-adjustment",
                              reference_oid: adjustment_oid,
                              title: payload.draft ? "Saved as draft" : "Submitted",
                              description: `${created.adjustment_number}: ${REASON_LABEL[payload.reason]}, ${lines.length} line${lines.length === 1 ? "" : "s"}, ${units(lines)} units`,
                        },
                        { tx, request }
                  );
                  return { adjustment_number: created.adjustment_number, status };
            });

            log.info(`Stock adjustment ${adjustment_number} created by ${user_id} as ${status}`);
            return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Adjustment submitted", data: { oid: adjustment_oid, adjustment_number, status } });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while creating a stock adjustment: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the adjustment. Try again in a moment." });
      }
};

module.exports = create_stock_adjustment;
