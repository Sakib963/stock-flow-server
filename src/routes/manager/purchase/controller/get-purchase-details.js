const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_purchase_details = async (request, res) => {
      try {
            let data;
            const purchaseSql = generate_purchase_data_sql(request);
            const productsSql = generate_products_data_sql(request);

            let purchase_data = null;
            let products = [];
            try {
                  const data_set = await get_data(purchaseSql);
                  purchase_data = data_set.length ? data_set[0] : null;
            } catch (e) {
                  log.error(`An exception occurred while getting Purchase details: ${e?.message}`);
            }
            try {
                  const data_set = await get_data(productsSql);
                  products = data_set.length ? data_set : [];
            } catch (e) {
                  log.error(`An exception occurred while getting Purchase Products list: ${e?.message}`);
            }

            data = {
                  ...purchase_data, products
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
      let query = `SELECT pr.oid, pr.bill_no, pr.date_of_purchase, to_char(pr.date_of_purchase, 'DD-MM-YYYY') as date_of_purchase_text, pr.supplier_oid, sup.name as supplier_name, pr.special_notes, CAST(pr.total_amount as INTEGER) as total_amount, pr.status, bt.batch_code, CAST(bt.total_sell as INTEGER) as total_sell FROM ${TABLE.PURCHASE} pr LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pr.supplier_oid LEFT JOIN ${TABLE.BATCH} bt ON pr.oid = bt.purchase_oid WHERE pr.oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

const generate_products_data_sql = (request) => {
      let query = `SELECT pd.oid, pd.purchase_oid, pd.product_oid, pr.name as product_name, pd.warehouse_oid, wr.name as warehouse_name, pd.aisle_oid, ai.name as aisle_name, pd.supplier_oid, sup.name as supplier_name, CAST(pd.quantity AS INTEGER) AS quantity, CAST(pd.unit_price as INTEGER) as unit_price, CAST(pd.total_price as INTEGER) as total_price, pd.status 
      FROM ${TABLE.PURCHASE_DETAILS} pd 
      LEFT JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid 
      LEFT JOIN ${TABLE.WAREHOUSE} wr ON wr.oid = pd.warehouse_oid 
      LEFT JOIN ${TABLE.AISLE} ai ON ai.oid = pd.aisle_oid 
      LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pd.supplier_oid 
      WHERE pd.purchase_oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

module.exports = get_purchase_details;
