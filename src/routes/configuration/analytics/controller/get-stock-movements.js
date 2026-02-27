const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { buildAnalyticsFilter } = require("../utils/analytics-filters");

const get_stock_movements = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, dateFrom, dateTo, page = 1, pageSize = 10 } = payload;

    log.info(
      `Fetching stock movements - Type: ${type || "all"}, ID: ${id || "N/A"}, Page: ${page}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    // Build WHERE clause for movements
    let movementWhere = ["1=1"];
    let movementValues = [];
    let paramIndex = 1;

    // Add entity filter
    if (type && type !== "all" && id) {
      switch (type) {
        case "category":
          movementWhere.push(`p.category_oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
        case "sub-category":
          movementWhere.push(`p.sub_category_oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
        case "brand":
          movementWhere.push(`p.brand_oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
        case "product":
          movementWhere.push(`p.oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
        case "warehouse":
          movementWhere.push(`pd.warehouse_oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
        case "aisle":
          movementWhere.push(`pd.aisle_oid = $${paramIndex++}`);
          movementValues.push(id);
          break;
      }
    }

    // Add date filter
    if (dateFrom) {
      movementWhere.push(`la.performed_on >= $${paramIndex++}`);
      movementValues.push(dateFrom);
    }
    if (dateTo) {
      movementWhere.push(
        `la.performed_on <= $${paramIndex++}::date + interval '1 day'`,
      );
      movementValues.push(dateTo);
    }

    // Count query
    const countQuery = `
            SELECT COUNT(*) as total
            FROM ${TABLE.ACTIVITY_LOG} la
            INNER JOIN ${TABLE.PRODUCT} p ON la.reference_oid = p.oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            WHERE la.reference_type IN ('purchase', 'product-return', 'product-dispose', 'transfer')
            AND ${movementWhere.join(" AND ")}
      `;

    const countResult = await get_data({
      text: countQuery,
      values: movementValues,
    });
    const total = parseInt(countResult[0]?.total || 0);

    // Main query with pagination
    const query = `
            SELECT
                  la.performed_on as date,
                  CASE
                        WHEN la.reference_type = 'purchase' THEN 'Purchase'
                        WHEN la.reference_type = 'product-return' THEN 'Return'
                        WHEN la.reference_type = 'product-dispose' THEN 'Dispose'
                        WHEN la.reference_type = 'transfer' THEN 'Transfer'
                        ELSE 'Other'
                  END as type,
                  p.name as product_name,
                  COALESCE(
                        CAST(
                              NULLIF(
                                    regexp_replace(la.description, '[^0-9-]', '', 'g'),
                                    ''
                              ) AS INTEGER
                        ),
                        0
                  ) as quantity,
                  0 as value,
                  la.reference_type,
                  la.reference_oid as reference_id,
                  la.title as reference_no,
                  COALESCE(la.description, '') as notes
            FROM ${TABLE.ACTIVITY_LOG} la
            INNER JOIN ${TABLE.PRODUCT} p ON la.reference_oid = p.oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            WHERE la.reference_type IN ('purchase', 'product-return', 'product-dispose', 'transfer')
            AND ${movementWhere.join(" AND ")}
            ORDER BY la.performed_on DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

    const values = [...movementValues, parseInt(pageSize), offset];
    const result = await get_data({ text: query, values });

    if (!result || result.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "No data found",
        data: {
          items: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
        },
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Stock movements fetched successfully",
      data: {
        items: result.map((row) => ({
          date: row.date,
          type: row.type,
          quantity: parseInt(row.quantity) || 0,
          value: parseFloat(row.value) || 0,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          referenceNo: row.reference_no,
          notes: row.notes,
        })),
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      },
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching stock movements: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

module.exports = get_stock_movements;
