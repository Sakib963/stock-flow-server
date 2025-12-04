const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

/**
 * Main controller function
 */
const get_dashboard_data = async (req, res) => {
      try {
            const query = {
                  text: `WITH 
                        total_sale AS (
                        SELECT COALESCE(SUM(total_amount), 0) AS total_sale_this_month
                        FROM ${TABLE.SALES}
                        WHERE EXTRACT(MONTH FROM created_on) = EXTRACT(MONTH FROM CURRENT_DATE)
                              AND EXTRACT(YEAR FROM created_on) = EXTRACT(YEAR FROM CURRENT_DATE)
                        ),
                        stock_value AS (
                        SELECT COALESCE(SUM(quantity_available * cost_price), 0) AS total_stock_value
                        FROM ${TABLE.INVENTORY}
                        WHERE status = 'ready_for_sale' AND intended_use = 'for_sale'
                        ),
                        counts AS (
                        SELECT
                              (SELECT COUNT(*) FROM ${TABLE.CATEGORIES}) AS total_categories,
                              (SELECT COUNT(*) FROM ${TABLE.SUPPLIER}) AS total_suppliers,
                              (SELECT COUNT(*) FROM ${TABLE.WAREHOUSE}) AS total_warehouses,
                              (SELECT COUNT(*) FROM ${TABLE.PRODUCT} WHERE is_deleted = FALSE) AS total_products
                        ),
                        recent_sales AS (
                        SELECT json_agg(row_to_json(s)) AS recent_sales
                        FROM (
                              SELECT oid, invoice_no, customer_name, total_amount, created_by, created_on
                              FROM ${TABLE.SALES}
                              ORDER BY created_on DESC
                              LIMIT 5
                        ) s
                        ),
                        salesman_sales AS (
                        SELECT json_agg(row_to_json(t)) AS salesman_sales_this_month
                        FROM (
                              SELECT s.created_by AS email, l.name AS salesman_name, SUM(s.total_amount) AS total_sale
                              FROM ${TABLE.SALES} s
                              LEFT JOIN ${TABLE.LOGIN} l ON l.email = s.created_by
                              WHERE EXTRACT(MONTH FROM s.created_on) = EXTRACT(MONTH FROM CURRENT_DATE)
                              AND EXTRACT(YEAR FROM s.created_on) = EXTRACT(YEAR FROM CURRENT_DATE)
                              GROUP BY s.created_by, l.name
                              ORDER BY total_sale DESC
                        ) t
                        ),
                        trending_products AS (
                        SELECT json_agg(row_to_json(t)) AS trending_products_this_month
                        FROM (
                              SELECT sd.product_oid, p.name AS product_name, SUM(sd.quantity) AS total_sold
                              FROM ${TABLE.SALE_DETAILS} sd
                              LEFT JOIN ${TABLE.SALES} sa ON sd.sales_oid = sa.oid
                              LEFT JOIN ${TABLE.PRODUCT} p ON sd.product_oid = p.oid
                              WHERE EXTRACT(MONTH FROM sa.created_on) = EXTRACT(MONTH FROM CURRENT_DATE)
                              AND EXTRACT(YEAR FROM sa.created_on) = EXTRACT(YEAR FROM CURRENT_DATE)
                              GROUP BY sd.product_oid, p.name
                              ORDER BY total_sold DESC
                              LIMIT 5
                        ) t
                        ),
                        top_suppliers AS (
                        SELECT json_agg(row_to_json(t)) AS top_suppliers_this_month
                        FROM (
                              SELECT p.supplier_oid, s.name AS supplier_name, SUM(sd.quantity) AS total_sold
                              FROM ${TABLE.SALE_DETAILS} sd
                              LEFT JOIN ${TABLE.SALES} sa ON sd.sales_oid = sa.oid
                              LEFT JOIN ${TABLE.INVENTORY} i ON sd.inventory_oid = i.oid
                              LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON i.purchase_details_oid = pd.oid
                              LEFT JOIN ${TABLE.PURCHASE} p ON pd.purchase_oid = p.oid
                              LEFT JOIN ${TABLE.SUPPLIER} s ON p.supplier_oid = s.oid
                              WHERE EXTRACT(MONTH FROM sa.created_on) = EXTRACT(MONTH FROM CURRENT_DATE)
                              AND EXTRACT(YEAR FROM sa.created_on) = EXTRACT(YEAR FROM CURRENT_DATE)
                              GROUP BY p.supplier_oid, s.name
                              ORDER BY total_sold DESC
                              LIMIT 5
                        ) t
                        ),
                        total_purchase AS (
                        SELECT COALESCE(SUM(total_amount), 0) AS total_purchase_this_month
                        FROM ${TABLE.PURCHASE}
                        WHERE EXTRACT(MONTH FROM created_on) = EXTRACT(MONTH FROM CURRENT_DATE)
                              AND EXTRACT(YEAR FROM created_on) = EXTRACT(YEAR FROM CURRENT_DATE)
                        )
                        SELECT
                        (SELECT total_sale_this_month FROM total_sale),
                        (SELECT total_stock_value FROM stock_value),
                        (SELECT total_categories FROM counts),
                        (SELECT total_suppliers FROM counts),
                        (SELECT total_warehouses FROM counts),
                        (SELECT total_products FROM counts),
                        (SELECT recent_sales FROM recent_sales),
                        (SELECT salesman_sales_this_month FROM salesman_sales),
                        (SELECT trending_products_this_month FROM trending_products),
                        (SELECT top_suppliers_this_month FROM top_suppliers),
                        (SELECT total_purchase_this_month FROM total_purchase);`,
                  values: []
            };

            const result = await get_data(query);

            return res.status(200).json({
                  code: 200,
                  message: "Dashboard data retrieved successfully",
                  data: result[0] // single row with all fields
            });
      } catch (error) {
            log.error(`dashboard api failed: ${error.message}`);
            return res.status(500).json({
                  code: 500,
                  message: "Something went wrong! Please try again later."
            });
      }
};


module.exports = get_dashboard_data;
