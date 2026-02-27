const { TABLE } = require("../../../../utils/constant");

/**
 * Build dynamic WHERE clause and JOINs for analytics queries
 * @param {string} type - Filter type: 'category', 'sub-category', 'brand', 'supplier', 'warehouse', 'aisle', 'product', 'all'
 * @param {string} id - Entity ID (OID)
 * @param {string} dateFrom - Start date (ISO format)
 * @param {string} dateTo - End date (ISO format)
 * @returns {Object} { joins, whereConditions, values, paramIndex }
 */
const buildAnalyticsFilter = (type, id, dateFrom, dateTo) => {
  let joins = [];
  let whereConditions = ["1=1"];
  let values = [];
  let paramIndex = 1;

  // Entity type filtering
  if (type && type !== "all" && id) {
    switch (type) {
      case "category":
        whereConditions.push(`p.category_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "sub-category":
        whereConditions.push(`p.sub_category_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "brand":
        whereConditions.push(`p.brand_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "supplier":
        // Need to join through purchase
        joins.push(
          `INNER JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid`,
        );
        whereConditions.push(`pu.supplier_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "warehouse":
        whereConditions.push(`pd.warehouse_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "aisle":
        whereConditions.push(`pd.aisle_oid = $${paramIndex++}`);
        values.push(id);
        break;

      case "product":
        whereConditions.push(`p.oid = $${paramIndex++}`);
        values.push(id);
        break;
    }
  }

  // Date range filtering on inventory creation
  if (dateFrom) {
    whereConditions.push(`i.created_on >= $${paramIndex++}`);
    values.push(dateFrom);
  }

  if (dateTo) {
    // Add one day to include the entire end date
    whereConditions.push(
      `i.created_on <= $${paramIndex++}::date + interval '1 day'`,
    );
    values.push(dateTo);
  }

  return {
    joins: joins.filter((j, index, self) => self.indexOf(j) === index), // Remove duplicates
    whereConditions,
    values,
    paramIndex,
  };
};

/**
 * Build common FROM clause with all necessary joins for inventory queries
 * @param {Array} additionalJoins - Additional join clauses
 * @returns {string} SQL FROM clause with JOINs
 */
const buildInventoryBaseQuery = (additionalJoins = []) => {
  const baseJoins = [
    `FROM ${TABLE.INVENTORY} i`,
    `INNER JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid`,
    `LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid`,
    `INNER JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid`,
    `LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid`,
    `INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid`,
    `LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid`,
    `LEFT JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid`,
  ];

  return [...baseJoins, ...additionalJoins].join("\n            ");
};

module.exports = {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
};
