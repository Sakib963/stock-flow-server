const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_dispose_list = async (request, res) => {
  try {
    const countResult = await get_data(generate_count_sql(request));
    const total = countResult[0]?.total || 0;

    const data_set = await get_data(generate_data_sql(request));
    const data = data_set.length ? data_set : [];

    log.info(`Product dispose list Found: ${data?.length} of ${total}`);
    return res.status(200).json({
      code: 200,
      message: "Product dispose list Found",
      total,
      data,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting product dispose list: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

const generate_count_sql = (request) => {
  let query = `SELECT COUNT(DISTINCT pd.oid) AS total FROM ${TABLE.PRODUCT_DISPOSE} pd LEFT JOIN ${TABLE.DISPOSE_DETAILS} dd ON dd.dispose_oid = pd.oid LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = dd.product_oid WHERE 1 = 1`;
  const values = [];

  if (request.query.search_text && request.query.search_text.trim() !== "") {
    const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
    query += ` AND (LOWER(pd.dispose_no) LIKE $${values.length + 1} OR LOWER(p.name) LIKE $${values.length + 2})`;
    values.push(searchText, searchText);
  }

  if (
    request.query.status &&
    request.query.status !== "null" &&
    request.query.status !== ""
  ) {
    query += ` AND pd.status = $${values.length + 1}`;
    values.push(request.query.status);
  }

  return { text: query, values };
};

const generate_data_sql = (request) => {
  let query = `
        SELECT pd.oid, pd.dispose_no, pd.disposal_method, pd.status,
              CAST(pd.total_dispose_quantity AS INTEGER) AS total_dispose_quantity,
              CAST(pd.total_dispose_value AS INTEGER) AS total_dispose_value,
              COUNT(DISTINCT dd.oid) AS product_count,
              to_char(pd.disposal_date, 'DD/MM/YYYY') as disposal_date,
              to_char(pd.created_on, 'DD/MM/YYYY') as created_on, pd.created_by
        FROM ${TABLE.PRODUCT_DISPOSE} pd
        LEFT JOIN ${TABLE.DISPOSE_DETAILS} dd ON dd.dispose_oid = pd.oid
        LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = dd.product_oid
        WHERE 1 = 1`;
  const values = [];

  if (request.query.search_text && request.query.search_text.trim() !== "") {
    const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
    query += ` AND (LOWER(pd.dispose_no) LIKE $${values.length + 1} OR LOWER(p.name) LIKE $${values.length + 2})`;
    values.push(searchText, searchText);
  }

  if (
    request.query.status &&
    request.query.status !== "null" &&
    request.query.status !== ""
  ) {
    query += ` AND pd.status = $${values.length + 1}`;
    values.push(request.query.status);
  }

  query += ` GROUP BY pd.oid, pd.dispose_no, pd.disposal_method, pd.status, pd.total_dispose_quantity, pd.total_dispose_value, pd.disposal_date, pd.created_on, pd.created_by`;
  query += ` ORDER BY pd.created_on DESC`;

  if (request.query.offset !== undefined) {
    query += ` OFFSET $${values.length + 1}`;
    values.push(Number(request.query.offset));
  }

  if (request.query.limit !== undefined) {
    query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
    values.push(Number(request.query.limit));
  }

  return { text: query, values };
};

module.exports = get_product_dispose_list;
