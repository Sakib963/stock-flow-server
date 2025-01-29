const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value, execute_values } = require("../../../../utils/database");
const { generate_batch_code } = require("../../../../utils/generate-batch-code");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_purchase = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check purchase
            const exiting_purchase = await check_existing_purchase(payload.bill_no)
            if (exiting_purchase) {
                  log.warn(`Bill No already exists [${payload.bill_no}]`);
                  return res.status(409).json({ code: 409, message: "Bill No Already Exists!" });
            }
            const purchase_oid = uuidv4();
            const batch_oid = uuidv4();

            const purchase_sql = {
                  text: `INSERT INTO ${TABLE.PURCHASE} (oid, bill_no, date_of_purchase, supplier_oid, total_amount,  special_notes, status, created_by) VALUES ( $1, $2, $3, $4, $5, $6, $7, $8)`,
                  values: [purchase_oid, payload.bill_no, payload.date_of_purchase, payload.supplier_oid, payload.total_amount, payload.special_notes, payload.status, user_id]
            }

            let batch_code;
            let is_unique = false;
            while (!is_unique) {
                  batch_code = generate_batch_code();
                  is_unique = await check_unique_batch_code(batch_code);
            }

            const batch_sql = {
                  text: `INSERT INTO ${TABLE.BATCH} (oid, batch_code, purchase_oid, supplier_oid, total_purchase, status, created_by) VALUES ( $1, $2, $3, $4, $5, $6, $7)`,
                  values: [batch_oid, batch_code, purchase_oid, payload.supplier_oid, payload.total_amount, payload.status, user_id]
            }

            let purchase_details_sql = [];
            let batch_details_sql = [];
            payload.products.map((product) => {
                  const purchase_details = {
                        text: `INSERT INTO ${TABLE.PURCHASE_DETAILS} (oid, purchase_oid, product_oid, warehouse_oid, aisle_oid, supplier_oid, quantity, unit_price, total_price, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                        values: [uuidv4(), purchase_oid, product.product_oid, product.warehouse_oid, product.aisle_oid, payload.supplier_oid, product.quantity, product.unit_price, product.total_price, "Active", user_id]
                  }
                  purchase_details_sql.push(purchase_details);

                  const batch_details = {
                        text: `INSERT INTO ${TABLE.BATCH_DETAILS} (oid, batch_oid, product_oid, warehouse_oid, aisle_oid, supplier_oid, purchase_quantity, available_quantity, unit_price, total_price, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                        values: [uuidv4(), batch_oid, product.product_oid, product.warehouse_oid, product.aisle_oid, payload.supplier_oid, product.quantity, product.quantity, product.unit_price, product.total_price, "Active", user_id]
                  }
                  batch_details_sql.push(batch_details);
            })

            await execute_values([purchase_sql, batch_sql, ...purchase_details_sql, ...batch_details_sql]);
      } catch (e) {
            log.error(`An exception occurred while creating purchase : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Purchase ${payload.bill_no} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Purchase Created Successfully!",
      });
}

const check_existing_purchase = async (bill_no) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.PURCHASE} where bill_no = $1`,
            values: [bill_no]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking purchase count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

const check_unique_batch_code = async (batch_code) => {
      const sql = {
            text: `SELECT COUNT(oid)::int4 as total FROM ${TABLE.BATCH} WHERE batch_code = $1`,
            values: [batch_code]
      }
      try {
            let data_set = await get_data(sql);
            return data_set[0]["total"] === 0;
      } catch (e) {
            log.error(`An exception occurred while checking batch code uniqueness: ${e?.message}`);
            throw new Error(e);
      }
}

module.exports = create_purchase