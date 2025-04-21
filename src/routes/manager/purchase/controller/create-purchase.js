const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_purchase = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const purchase_oid = uuidv4();
            const purchase_sql = {
                  text: `INSERT INTO ${TABLE.PURCHASE} (oid, supplier_oid, total_amount, special_notes, payment_status, paid_amount, purchase_type, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                  values: [purchase_oid, payload.supplier_oid, payload.total_amount, payload.special_notes, payload.payment_status, payload.paid_amount, payload.purchase_type, 'Submitted', user_id]
            };
            const purchase_details_sql = []
            payload.products.map((product) => {
                  let details_sql = {
                        text: `INSERT INTO ${TABLE.PURCHASE_DETAILS} (oid, purchase_oid, product_oid, warehouse_oid, aisle_oid, ordered_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        values: [uuidv4(), purchase_oid, product.product_oid, product.warehouse_oid, product.aisle_oid, product.quantity, product.unit_price]
                  }
                  purchase_details_sql.push(details_sql);
            })

            await execute_values([purchase_sql, ...purchase_details_sql]);
      } catch (e) {
            log.error(`An exception occurred while creating purchase : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Purchase Order created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Purchase Order Created Successfully!",
      });
}

module.exports = create_purchase