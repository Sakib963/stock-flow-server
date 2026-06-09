const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_sub_category_list_for_dropdown = async (request, res) => {
  try {
    const dataSql = generate_data_sql(request);

    const data_set = await get_data(dataSql);
    const data = data_set.length ? data_set : [];

    // Step 3: Respond with total count and paginated data
    log.info(`Sub-Category list for dropdown Found: ${data?.length}`);
    return res.status(200).json({
      code: 200,
      message: "Sub-Category list For Dropdown Found",
      data,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting sub-category list for dropdown information: ${e?.message}`,
    );
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }
};

const generate_data_sql = (request) => {
  let query = `SELECT sc.oid as value, sc.name as label, sc.category_oid, c.name as "groupLabel"  FROM ${TABLE.SUB_CATEGORIES} sc LEFT JOIN ${TABLE.CATEGORIES} c ON sc.category_oid = c.oid WHERE c.status = 'Active'`;
  let values = [];

  if (request.query.category_oid) {
    query += " AND sc.category_oid = $1";
    values.push(request.query.category_oid);
  }

  query += " ORDER BY c.name ASC, sc.name ASC";
  return { text: query, values };
};

module.exports = get_sub_category_list_for_dropdown;
