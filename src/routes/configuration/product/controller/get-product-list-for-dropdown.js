const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list_for_dropdown = async (request, res) => {
  try {
    const dataSql = generate_data_sql(request);
    const grouped = `${request?.query?.grouped || ""}`.toLowerCase() === "true";

    const data_set = await get_data(dataSql);
    const flatData = data_set.length ? data_set : [];
    const data = grouped ? group_products_by_category(flatData) : flatData;

    // Step 3: Respond with total count and paginated data
    log.info(`Product list for dropdown Found: ${flatData?.length}`);
    return res.status(200).json({
      code: 200,
      message: "Product list For Dropdown Found",
      data,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting product list for dropdown information: ${e?.message}`,
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
  let query = `SELECT p.oid as value, p.name as label,
      COALESCE(c.name, 'Uncategorized') as category_label,
      COALESCE(sc.name, 'No Sub Category') as sub_category_label
      FROM ${TABLE.PRODUCT} p
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
      WHERE p.status = 'Active' AND p.is_deleted = FALSE
      ORDER BY c.name ASC, sc.name ASC, p.name ASC`;
  let values = [];
  return { text: query, values };
};

const group_products_by_category = (items) => {
  const groupedMap = new Map();

  items.forEach((item) => {
    const categoryLabel = item.category_label || "Uncategorized";
    const subCategoryLabel = item.sub_category_label || "No Sub Category";
    const groupLabel = `${categoryLabel} / ${subCategoryLabel}`;

    if (!groupedMap.has(groupLabel)) {
      groupedMap.set(groupLabel, []);
    }

    groupedMap.get(groupLabel).push({
      value: item.value,
      label: item.label,
      category_label: categoryLabel,
      sub_category_label: subCategoryLabel,
    });
  });

  return Array.from(groupedMap.entries()).map(([label, options]) => ({
    label,
    options,
  }));
};

module.exports = get_product_list_for_dropdown;
