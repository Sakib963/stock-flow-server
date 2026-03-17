const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../utils/database");
const { log } = require("../../../utils/log");

const FEATURE_LABELS = {
  category: "Category",
  "sub-category": "Sub Category",
  brand: "Brands",
  supplier: "Supplier",
  product: "Product",
  warehouse: "Warehouse",
  aisle: "Aisle/Zone",
  "purchase-order": "Purchase Order",
  "product-return": "Product Return",
  dispose: "Dispose",
  invoice: "Invoice",
  attendance: "Attendance",
};

const get_activity_log_list = async (request, res) => {
  const payload = request.body || {};

  try {
    const countSql = generate_count_sql(payload);
    const dataSql = generate_data_sql(payload);

    const countResult = await get_data(countSql);
    const total = countResult?.[0]?.total || 0;

    const dataSet = await get_data(dataSql);

    const data = (dataSet || []).map((row) => {
      const featureKey = row.reference_type;

      return {
        oid: row.oid,
        reference_oid: row.reference_oid,
        feature_key: featureKey,
        feature_label: FEATURE_LABELS[featureKey] || to_title_case(featureKey),
        title: row.title,
        description: row.description,
        performed_by: row.performed_by,
        performed_on: row.performed_on,
      };
    });

    // Step 3: Respond with total count and paginated data
    log.info(`Activity log list Found: ${data?.length} of ${total}`);
    return res.status(200).json({
      code: 200,
      message: "Activity log list found",
      total,
      data,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting activity log list: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

const generate_count_sql = (payload) => {
  let query = `SELECT COUNT(*)::int AS total FROM ${TABLE.ACTIVITY_LOG} WHERE 1 = 1`;
  const values = [];

  if (payload.feature_key && payload.feature_key.trim() !== "") {
    query += ` AND reference_type = $${values.length + 1}`;
    values.push(payload.feature_key.trim());
  }

  if (payload.search_text && payload.search_text.trim() !== "") {
    const searchText = `%${payload.search_text.trim().toLowerCase()}%`;
    query += ` AND (`;
    query += `LOWER(title) LIKE $${values.length + 1} `;
    query += `OR LOWER(COALESCE(description, '')) LIKE $${values.length + 2} `;
    query += `OR LOWER(performed_by) LIKE $${values.length + 3}`;
    query += `)`;
    values.push(searchText, searchText, searchText);
  }

  if (payload.date_from) {
    query += ` AND performed_on >= $${values.length + 1}::date`;
    values.push(payload.date_from);
  }

  if (payload.date_to) {
    query += ` AND performed_on <= ($${values.length + 1}::date + interval '1 day')`;
    values.push(payload.date_to);
  }

  return { text: query, values };
};

const generate_data_sql = (payload) => {
  let query = `SELECT oid, reference_oid, reference_type, title, description, performed_by, performed_on FROM ${TABLE.ACTIVITY_LOG} WHERE 1 = 1`;
  const values = [];

  if (payload.feature_key && payload.feature_key.trim() !== "") {
    query += ` AND reference_type = $${values.length + 1}`;
    values.push(payload.feature_key.trim());
  }

  if (payload.search_text && payload.search_text.trim() !== "") {
    const searchText = `%${payload.search_text.trim().toLowerCase()}%`;
    query += ` AND (`;
    query += `LOWER(title) LIKE $${values.length + 1} `;
    query += `OR LOWER(COALESCE(description, '')) LIKE $${values.length + 2} `;
    query += `OR LOWER(performed_by) LIKE $${values.length + 3}`;
    query += `)`;
    values.push(searchText, searchText, searchText);
  }

  if (payload.date_from) {
    query += ` AND performed_on >= $${values.length + 1}::date`;
    values.push(payload.date_from);
  }

  if (payload.date_to) {
    query += ` AND performed_on <= ($${values.length + 1}::date + interval '1 day')`;
    values.push(payload.date_to);
  }

  query += ` ORDER BY performed_on DESC`;

  if (payload.offset !== undefined && payload.offset !== null) {
    query += ` OFFSET $${values.length + 1}`;
    values.push(Number(payload.offset) || 0);
  }

  if (payload.limit !== undefined && payload.limit !== null) {
    query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
    values.push(Number(payload.limit) || 20);
  }

  return { text: query, values };
};

const to_title_case = (value = "") => {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

module.exports = get_activity_log_list;
