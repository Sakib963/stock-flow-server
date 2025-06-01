const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const delete_invoice = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            let sql_array = [];
            let sales_sql = {
                  text: `DELETE FROM ${TABLE.SALES} WHERE oid = $1 AND created_by = $2 RETURNING oid`,
                  values: [payload.oid, user_id]
            }
            sql_array.push(sales_sql);

            let sales_details_sql = {
                  text: `DELETE FROM ${TABLE.SALE_DETAILS} WHERE sales_oid = $1`,
                  values: [payload.oid]
            }
            sql_array.push(sales_details_sql);

            await execute_values(sql_array)
      } catch (e) {
            log.error(`An exception occurred while deleting Invoice : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
      log.info(`Invoice ${payload.oid} deleted successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Invoice Deleted Successfully!",
      });
}

module.exports = delete_invoice