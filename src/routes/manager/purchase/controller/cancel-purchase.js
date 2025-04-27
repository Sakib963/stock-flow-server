const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const cancel_purchase = async (request, res) => {
      try {
            let data;
            let user_id = request.credentials.user_id;
            const purchaseSql = generate_purchase_data_sql(request);
            await execute_value(purchaseSql);

            // Step 2: Respond with data
            log.info(`Purchase cancelled for oid: ${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Purchase cancelled successfully!",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while canceling Purchase details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_purchase_data_sql = (request) => {
      let query = `UPDATE ${TABLE.PURCHASE} SET status = $1, cancelled_by = $2, cancelled_on = clock_timestamp() WHERE oid = $3`;
      let values = ['Cancelled', request.credentials.user_id,  request.query.oid];

      return { text: query, values };
};

module.exports = cancel_purchase;
