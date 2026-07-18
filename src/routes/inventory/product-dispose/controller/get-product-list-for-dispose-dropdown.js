const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list_for_dispose_dropdown = async (request, res) => {
  try {
    const data_set = await get_data(generate_data_sql());
    const data = data_set.length ? data_set : [];

    log.info(`Product list for dispose dropdown Found: ${data?.length}`);
    return res.status(200).json({
      code: 200,
      message: "Product list For Dispose Dropdown Found",
      data,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting product list for dispose dropdown: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

const generate_data_sql = () => {
  const query = `
      SELECT i.oid AS inventory_oid, i.product_oid, i.batch_code,
            CAST(i.quantity_available AS INTEGER) AS quantity_available,
            CAST(i.cost_price AS INTEGER) AS cost_price,
            p.name AS product_name,
            p.name || ' (' || i.batch_code || ')' AS label
      FROM ${TABLE.INVENTORY} i
      LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
      WHERE i.quantity_available > 0
      ORDER BY p.name ASC, i.batch_code ASC`;
  return { text: query, values: [] };
};

module.exports = get_product_list_for_dispose_dropdown;
