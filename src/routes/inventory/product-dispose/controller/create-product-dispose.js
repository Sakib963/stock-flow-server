const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { check_lines, insert_lines, write_totals, describe } = require("../utils/dispose-rules");
const { v4: uuidv4 } = require("uuid");
const { business_number, business_today } = require("../../../../utils/business-time");

// Saving moves nothing, as a Draft or as Submitted: stock leaves only on approval, in a separate click.
const create_product_dispose = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      const dispose_oid = uuidv4();

      try {
            const { dispose_no, status } = await execute_transaction(async (tx) => {
                  await check_lines(tx, payload.lines, !payload.draft);
                  const status = payload.draft ? "Draft" : "Submitted";
                  const [created] = (
                        await tx.execute_value({
                              text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE} (oid, dispose_no, disposal_date, disposal_method, notes, status, created_by, submitted_by, submitted_on)
                                     VALUES ($1, ${business_number("DSP", "product_dispose_number_seq")}, ${business_today}, $2, $3, $4::varchar, $5, $6, CASE WHEN $4::varchar = 'Submitted' THEN clock_timestamp() END) RETURNING dispose_no`,
                              values: [dispose_oid, payload.method, payload.note, status, user_id, status === "Submitted" ? user_id : null],
                        })
                  ).rows;
                  await insert_lines(tx, dispose_oid, payload.lines, user_id, uuidv4);
                  await write_totals(tx, dispose_oid);
                  await saveLogActivity({ reference_type: "product-dispose", reference_oid: dispose_oid, title: payload.draft ? "Saved as draft" : "Submitted", description: describe(created.dispose_no, payload.lines) }, { tx, request });
                  return { dispose_no: created.dispose_no, status };
            });

            log.info(`Disposal ${dispose_no} created by ${user_id} as ${status}`);
            return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Disposal submitted", data: { oid: dispose_oid, dispose_no, status } });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while creating a disposal: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the disposal. Try again in a moment." });
      }
};

module.exports = create_product_dispose;
