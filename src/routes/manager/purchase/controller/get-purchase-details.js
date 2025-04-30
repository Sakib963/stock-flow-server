const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_purchase_details = async (request, res) => {
      try {
            let data;
            const purchaseSql = generate_purchase_data_sql(request);
            const productSql = generate_products_data_sql(request);

            try {
                  const data_set = await get_data(purchaseSql);
                  let purchase_data = data_set.length ? data_set[0] : null;
                  data = { ...purchase_data };
                  // get product list
                  const product_data_set = await get_data(productSql);
                  let products = product_data_set.length ? product_data_set : null;
                  data = { ...data, products };
            } catch (e) {
                  log.error(`An exception occurred while getting Purchase details: ${e?.message}`);
            }

            // Step 2: Respond with data
            log.info(`Purchase details Found for oid: ${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Purchase details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Purchase details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_purchase_data_sql = (request) => {
      let query = `SELECT pr.oid, pr.supplier_oid, pr.total_amount, pr.special_notes, pr.payment_status, pr.paid_amount, pr.purchase_type, pr.status, pr.created_by, to_char(pr.created_on, 'DD/MM/YYYY') as created_on, pr.cancelled_by, to_char(pr.cancelled_on, 'DD/MM/YYYY') as cancelled_on, pr.verified_by, to_char(pr.verified_on, 'DD/MM/YYYY') as verified_on, sup.name as supplier_name FROM ${TABLE.PURCHASE} pr LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pr.supplier_oid WHERE pr.oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

const generate_products_data_sql = (request) => {
      let query = `SELECT pd.oid, pd.purchase_oid, pd.product_oid, pr.name as product_name, pd.warehouse_oid, wr.name as warehouse_name, pd.aisle_oid, ai.name as aisle_name, CAST(pd.ordered_quantity AS INTEGER) AS quantity, CAST(pd.ordered_unit_price as INTEGER) as unit_price, CAST(i.selling_price AS INTEGER) AS selling_price, CAST(i.maximum_discount AS INTEGER) AS maximum_discount, i.status, i.intended_use
      FROM ${TABLE.PURCHASE_DETAILS} pd 
      LEFT JOIN ${TABLE.INVENTORY} i ON pd.oid = i.purchase_details_oid 
      LEFT JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid 
      LEFT JOIN ${TABLE.WAREHOUSE} wr ON wr.oid = pd.warehouse_oid 
      LEFT JOIN ${TABLE.AISLE} ai ON ai.oid = pd.aisle_oid 
      WHERE pd.purchase_oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

module.exports = get_purchase_details;
