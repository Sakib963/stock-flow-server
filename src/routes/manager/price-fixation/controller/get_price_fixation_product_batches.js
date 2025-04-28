const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_price_fixation_product_batches = async (request, res) => {
      try {
            const { product_oid } = request.query;

            const query = `SELECT 
            i.oid AS inventory_oid,
            i.product_oid, 
            i.batch_code,
            CAST(i.initial_quantity as INTEGER) as initial_quantity,
            CAST(i.quantity_available as INTEGER) as quantity_available,
            CAST(i.cost_price as INTEGER) as cost_price,
            CAST(i.selling_price as INTEGER) as selling_price,
            CAST(i.maximum_discount as INTEGER) as maximum_discount,
            i.intended_use,
            i.status,
            to_char(i.created_on, 'DD/MM/YYYY') AS created_on,
            p.name as product_name
        FROM ${TABLE.INVENTORY} i
        LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
        WHERE i.product_oid = $1
        ORDER BY i.created_on ASC`;

            const values = [product_oid];

            const data = await get_data({ text: query, values });

            log.info(`Price fixation batches found for product: ${product_oid}, Count: ${data.length}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product batch list found",
                  data,
            });
      } catch (e) {
            log.error(`Exception while getting product batch details: ${e.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

module.exports = get_price_fixation_product_batches;
