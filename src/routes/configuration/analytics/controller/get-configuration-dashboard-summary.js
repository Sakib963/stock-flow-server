const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_configuration_dashboard_summary = async (_request, res) => {
  try {
    const query = {
      text: `WITH active_counts AS (
              SELECT
                (SELECT COUNT(*) FROM ${TABLE.CATEGORIES} WHERE status = 'Active') AS active_categories,
                (SELECT COUNT(*) FROM ${TABLE.SUB_CATEGORIES} WHERE status = 'Active') AS active_sub_categories,
                (SELECT COUNT(*) FROM ${TABLE.BRANDS} WHERE status = 'Active') AS active_brands,
                (SELECT COUNT(*) FROM ${TABLE.SUPPLIER} WHERE status = 'Active') AS active_suppliers,
                (SELECT COUNT(*) FROM ${TABLE.PRODUCT} WHERE status = 'Active' AND is_deleted = FALSE) AS active_products,
                (SELECT COUNT(*) FROM ${TABLE.WAREHOUSE} WHERE status = 'Active') AS active_warehouses,
                (SELECT COUNT(*) FROM ${TABLE.AISLE} WHERE status = 'Active') AS active_aisles,
                (SELECT COUNT(DISTINCT sku) FROM ${TABLE.PRODUCT} WHERE is_deleted = FALSE) AS total_skus
            ),
            totals AS (
              SELECT
                (SELECT COUNT(*) FROM ${TABLE.CATEGORIES}) AS total_categories,
                (SELECT COUNT(*) FROM ${TABLE.SUB_CATEGORIES}) AS total_sub_categories,
                (SELECT COUNT(*) FROM ${TABLE.BRANDS}) AS total_brands,
                (SELECT COUNT(*) FROM ${TABLE.SUPPLIER}) AS total_suppliers,
                (SELECT COUNT(*) FROM ${TABLE.PRODUCT} WHERE is_deleted = FALSE) AS total_products,
                (SELECT COUNT(*) FROM ${TABLE.WAREHOUSE}) AS total_warehouses,
                (SELECT COUNT(*) FROM ${TABLE.AISLE}) AS total_aisles
            ),
            category_distribution AS (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'name', dataset.name,
                    'value', dataset.value,
                    'percent', dataset.percent
                  )
                  ORDER BY dataset.value DESC
                ),
                '[]'::json
              ) AS data
              FROM (
                SELECT
                  c.name,
                  COUNT(p.oid)::int AS value,
                  CASE
                    WHEN (SELECT total_products FROM totals) = 0 THEN 0
                    ELSE ROUND((COUNT(p.oid)::numeric * 100) / (SELECT total_products FROM totals), 2)
                  END AS percent
                FROM ${TABLE.CATEGORIES} c
                LEFT JOIN ${TABLE.PRODUCT} p
                  ON p.category_oid = c.oid
                  AND p.is_deleted = FALSE
                  AND p.status = 'Active'
                WHERE c.status = 'Active'
                GROUP BY c.oid, c.name
                HAVING COUNT(p.oid) > 0
                ORDER BY COUNT(p.oid) DESC
                LIMIT 6
              ) dataset
            ),
            top_suppliers AS (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'name', dataset.name,
                    'value', dataset.value
                  )
                  ORDER BY dataset.value DESC
                ),
                '[]'::json
              ) AS data
              FROM (
                SELECT
                  s.name,
                  COUNT(DISTINCT pd.product_oid)::int AS value
                FROM ${TABLE.SUPPLIER} s
                LEFT JOIN ${TABLE.PURCHASE} pu ON pu.supplier_oid = s.oid
                LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = pu.oid
                WHERE s.status = 'Active'
                GROUP BY s.oid, s.name
                HAVING COUNT(DISTINCT pd.product_oid) > 0
                ORDER BY COUNT(DISTINCT pd.product_oid) DESC
                LIMIT 6
              ) dataset
            ),
            productive_categories AS (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'name', dataset.name,
                    'products', dataset.products,
                    'sub_categories', dataset.sub_categories,
                    'percent', dataset.percent
                  )
                  ORDER BY dataset.products DESC
                ),
                '[]'::json
              ) AS data
              FROM (
                SELECT
                  c.name,
                  COUNT(DISTINCT p.oid)::int AS products,
                  COUNT(DISTINCT sc.oid)::int AS sub_categories,
                  CASE
                    WHEN (SELECT total_products FROM totals) = 0 THEN 0
                    ELSE ROUND((COUNT(DISTINCT p.oid)::numeric * 100) / (SELECT total_products FROM totals), 2)
                  END AS percent
                FROM ${TABLE.CATEGORIES} c
                LEFT JOIN ${TABLE.SUB_CATEGORIES} sc
                  ON sc.category_oid = c.oid
                  AND sc.status = 'Active'
                LEFT JOIN ${TABLE.PRODUCT} p
                  ON p.category_oid = c.oid
                  AND p.is_deleted = FALSE
                  AND p.status = 'Active'
                WHERE c.status = 'Active'
                GROUP BY c.oid, c.name
                HAVING COUNT(DISTINCT p.oid) > 0
                ORDER BY COUNT(DISTINCT p.oid) DESC
                LIMIT 4
              ) dataset
            ),
            recent_activities AS (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'title', dataset.title,
                    'description', dataset.description,
                    'performed_on', dataset.performed_on,
                    'reference_type', dataset.reference_type
                  )
                  ORDER BY dataset.performed_on DESC
                ),
                '[]'::json
              ) AS data
              FROM (
                SELECT
                  title,
                  description,
                  performed_on,
                  reference_type
                FROM ${TABLE.ACTIVITY_LOG}
                ORDER BY performed_on DESC
                LIMIT 5
              ) dataset
            ),
            data_quality AS (
              SELECT
                COUNT(*) FILTER (WHERE is_deleted = FALSE AND status = 'Active')::int AS total_active_products,
                COUNT(*) FILTER (
                  WHERE is_deleted = FALSE
                    AND status = 'Active'
                    AND COALESCE(TRIM(photo), '') <> ''
                )::int AS products_with_images,
                COUNT(*) FILTER (
                  WHERE is_deleted = FALSE
                    AND status = 'Active'
                    AND COALESCE(TRIM(photo), '') = ''
                )::int AS missing_images,
                COUNT(*) FILTER (
                  WHERE is_deleted = FALSE
                    AND status = 'Active'
                    AND brand_oid IS NOT NULL
                )::int AS products_with_brands,
                COUNT(*) FILTER (
                  WHERE is_deleted = FALSE
                    AND status = 'Active'
                    AND brand_oid IS NULL
                )::int AS missing_brands,
                COUNT(*) FILTER (
                  WHERE is_deleted = FALSE
                    AND status = 'Active'
                    AND category_oid IS NOT NULL
                    AND sub_category_oid IS NOT NULL
                    AND brand_oid IS NOT NULL
                    AND COALESCE(TRIM(photo), '') <> ''
                    AND COALESCE(TRIM(sku), '') <> ''
                )::int AS complete_product_data
              FROM ${TABLE.PRODUCT}
            )
            SELECT
              json_build_object(
                'active_categories', COALESCE(ac.active_categories, 0),
                'active_sub_categories', COALESCE(ac.active_sub_categories, 0),
                'active_brands', COALESCE(ac.active_brands, 0),
                'active_suppliers', COALESCE(ac.active_suppliers, 0),
                'active_products', COALESCE(ac.active_products, 0),
                'active_warehouses', COALESCE(ac.active_warehouses, 0),
                'active_aisles', COALESCE(ac.active_aisles, 0),
                'total_skus', COALESCE(ac.total_skus, 0)
              ) AS stat_cards,
              cd.data AS category_distribution,
              ts.data AS top_suppliers,
              pc.data AS productive_categories,
              ra.data AS recent_activities,
              json_build_object(
                'total', COALESCE(dq.total_active_products, 0),
                'products_with_images', COALESCE(dq.products_with_images, 0),
                'missing_images', COALESCE(dq.missing_images, 0),
                'products_with_brands', COALESCE(dq.products_with_brands, 0),
                'missing_brands', COALESCE(dq.missing_brands, 0),
                'complete_product_data', COALESCE(dq.complete_product_data, 0)
              ) AS data_quality,
              json_build_object(
                'avg_products_per_category',
                  CASE WHEN COALESCE(ac.active_categories, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_products, 0)::numeric / ac.active_categories, 1)
                  END,
                'avg_sub_categories_per_category',
                  CASE WHEN COALESCE(ac.active_categories, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_sub_categories, 0)::numeric / ac.active_categories, 1)
                  END,
                'products_per_supplier',
                  CASE WHEN COALESCE(ac.active_suppliers, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_products, 0)::numeric / ac.active_suppliers, 1)
                  END,
                'avg_aisles_per_warehouse',
                  CASE WHEN COALESCE(ac.active_warehouses, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_aisles, 0)::numeric / ac.active_warehouses, 1)
                  END,
                'products_per_warehouse',
                  CASE WHEN COALESCE(ac.active_warehouses, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_products, 0)::numeric / ac.active_warehouses, 1)
                  END,
                'avg_products_per_brand',
                  CASE WHEN COALESCE(ac.active_brands, 0) = 0 THEN 0
                  ELSE ROUND(COALESCE(ac.active_products, 0)::numeric / ac.active_brands, 1)
                  END,
                'brands_with_10_plus_products',
                  (
                    SELECT COUNT(*)::int
                    FROM (
                      SELECT p.brand_oid
                      FROM ${TABLE.PRODUCT} p
                      WHERE p.is_deleted = FALSE
                        AND p.status = 'Active'
                        AND p.brand_oid IS NOT NULL
                      GROUP BY p.brand_oid
                      HAVING COUNT(*) >= 10
                    ) brand_counts
                  )
              ) AS insights,
              json_build_object(
                'active_items',
                  COALESCE(ac.active_categories, 0) +
                  COALESCE(ac.active_sub_categories, 0) +
                  COALESCE(ac.active_brands, 0) +
                  COALESCE(ac.active_suppliers, 0) +
                  COALESCE(ac.active_products, 0) +
                  COALESCE(ac.active_warehouses, 0) +
                  COALESCE(ac.active_aisles, 0),
                'inactive_items',
                  (COALESCE(t.total_categories, 0) - COALESCE(ac.active_categories, 0)) +
                  (COALESCE(t.total_sub_categories, 0) - COALESCE(ac.active_sub_categories, 0)) +
                  (COALESCE(t.total_brands, 0) - COALESCE(ac.active_brands, 0)) +
                  (COALESCE(t.total_suppliers, 0) - COALESCE(ac.active_suppliers, 0)) +
                  (COALESCE(t.total_products, 0) - COALESCE(ac.active_products, 0)) +
                  (COALESCE(t.total_warehouses, 0) - COALESCE(ac.active_warehouses, 0)) +
                  (COALESCE(t.total_aisles, 0) - COALESCE(ac.active_aisles, 0))
              ) AS status_overview
            FROM active_counts ac
            CROSS JOIN totals t
            CROSS JOIN category_distribution cd
            CROSS JOIN top_suppliers ts
            CROSS JOIN productive_categories pc
            CROSS JOIN recent_activities ra
            CROSS JOIN data_quality dq;`,
      values: [],
    };

    const result = await get_data(query);
    const data = result?.[0] || {};

    return res.status(200).json({
      code: 200,
      message: "Configuration dashboard summary fetched successfully",
      data: {
        stat_cards: data.stat_cards || {},
        category_distribution: data.category_distribution || [],
        top_suppliers: data.top_suppliers || [],
        productive_categories: data.productive_categories || [],
        recent_activities: data.recent_activities || [],
        data_quality: data.data_quality || {},
        insights: data.insights || {},
        status_overview: data.status_overview || {},
      },
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching configuration dashboard summary: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

module.exports = get_configuration_dashboard_summary;
