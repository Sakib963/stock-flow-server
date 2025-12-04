const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const delete_product = async (request, res) => {
      try {
            const deleteSql = generate_delete_sql(request);
            await execute_value(deleteSql);

            log.info(`Product soft-deleted successfully: oid=${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product deleted successfully",
            });
      } catch (e) {
            log.error(`Failed to delete product: ${e?.message}`);
            return res.status(500).json({
                  code: 500,
                  message: "Something went wrong! Please try again later!",
            });
      }
};

const generate_delete_sql = (request) => {
      const query = `
        UPDATE product
        SET 
            is_deleted = TRUE,
            deleted_on = clock_timestamp(),
            deleted_by = $2
        WHERE oid = $1`;

      const values = [
            request.query.oid,
            request.credentials?.user_id || "system"
      ];

      return { text: query, values };
};

module.exports = delete_product;
