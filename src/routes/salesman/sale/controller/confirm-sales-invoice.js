const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const confirm_sales_invoice = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql_array = generate_sql_array(payload, user_id);
            await execute_values(sql_array);
      } catch (e) {
            log.error(`An exception occurred while confirming the purchase : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
      log.info(`Invoice ${payload.invoice_no} confirmed successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Invoice Confirmed Successfully!",
      });
}

const generate_sql_array = (payload, user_id) => {
      let sql_array = [];
      if (payload?.oid) {
            const invoice_sql = {
                  text: `UPDATE ${TABLE.SALES} SET invoice_no = $1, customer_name = $2, customer_phone = $3, customer_address = $4, customer_email = $5, payment_method = $6, payment_reference = $7, payment_status = $8, notes = $9, status = $10, total_amount = $11, edited_by = $12, edited_on = clock_timestamp() WHERE oid = $13`,
                  values: [
                        payload.invoice_no,
                        payload.customer_name,
                        payload.customer_phone,
                        payload.customer_address,
                        payload.customer_email,
                        payload.payment_method,
                        payload.payment_reference,
                        payload.payment_status,
                        payload.notes,
                        payload.status,
                        payload.total_amount,
                        user_id,
                        payload.oid
                  ]
            }
            sql_array.push(invoice_sql);
            const delete_products_sql = {
                  text: `DELETE FROM ${TABLE.SALE_DETAILS} WHERE sales_oid = $1`,
                  values: [payload.oid]
            }
            sql_array.push(delete_products_sql);
            let product_stat_array = [];
            let inventory_array = [];
            if (Array.isArray(payload.products) && payload.products.length > 0) {
                  for (const product of payload.products) {
                        const insert_products_sql = {
                              text: `INSERT INTO ${TABLE.SALE_DETAILS} (oid, sales_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                              values: [
                                    uuidv4(),
                                    payload.oid,
                                    product.inventory_oid,
                                    product.product_oid,
                                    product.product_name,
                                    product.quantity_available,
                                    product.quantity,
                                    product.unit_price,
                                    product.discount,
                                    product.total
                              ]
                        }
                        sql_array.push(insert_products_sql);

                        const product_stat_sql = {
                              text: `UPDATE ${TABLE.PRODUCT_STATS} SET total_sold = total_sold + $1, last_edited_on = clock_timestamp() WHERE product_oid = $2`,
                              values: [
                                    product.quantity,
                                    product.product_oid
                              ]
                        }
                        product_stat_array.push(product_stat_sql);

                        const inventory_sql = {
                              text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available - $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                              values: [
                                    product.quantity,
                                    user_id,
                                    product.inventory_oid
                              ]
                        }
                        inventory_array.push(inventory_sql);
                  }
            }
            sql_array.push(...product_stat_array);
            sql_array.push(...inventory_array);
      } else {
            const invoice_oid = uuidv4();
            const invoice_sql = {
                  text: `INSERT INTO ${TABLE.SALES} (oid, invoice_no, customer_name, customer_phone, customer_address, customer_email, payment_method, payment_reference, payment_status, notes, status, total_amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                  values: [
                        invoice_oid,
                        payload.invoice_no,
                        payload.customer_name,
                        payload.customer_phone,
                        payload.customer_address,
                        payload.customer_email,
                        payload.payment_method,
                        payload.payment_reference,
                        payload.payment_status,
                        payload.notes,
                        payload.status,
                        payload.total_amount,
                        user_id
                  ]
            }
            sql_array.push(invoice_sql);
            let product_stat_array = [];
            let inventory_array = [];
            if (Array.isArray(payload.products) && payload.products.length > 0) {
                  for (const product of payload.products) {
                        const insert_products_sql = {
                              text: `INSERT INTO ${TABLE.SALE_DETAILS} (oid, sales_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                              values: [
                                    uuidv4(),
                                    invoice_oid,
                                    product.inventory_oid,
                                    product.product_oid,
                                    product.product_name,
                                    product.quantity_available,
                                    product.quantity,
                                    product.unit_price,
                                    product.discount,
                                    product.total
                              ]
                        }
                        sql_array.push(insert_products_sql);

                        const product_stat_sql = {
                              text: `UPDATE ${TABLE.PRODUCT_STATS} SET total_sold = total_sold + $1, last_edited_on = clock_timestamp() WHERE product_oid = $2`,
                              values: [
                                    product.quantity,
                                    product.product_oid
                              ]
                        }
                        product_stat_array.push(product_stat_sql);

                        const inventory_sql = {
                              text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available - $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                              values: [
                                    product.quantity,
                                    user_id,
                                    product.inventory_oid
                              ]
                        }
                        inventory_array.push(inventory_sql);
                  }
            }
            sql_array.push(...product_stat_array);
            sql_array.push(...inventory_array);
      }
      return sql_array;
}

module.exports = confirm_sales_invoice;