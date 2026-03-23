const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_purchase_order_details = async (request, res) => {
  try {
    const purchaseOid = request.params.oid || request.query.oid;

    const detailsSql = generate_purchase_data_sql(purchaseOid);
    const productsSql = generate_products_data_sql(purchaseOid);
    const statsSql = generate_stats_sql(purchaseOid);

    const details_set = await get_data(detailsSql);
    const details = details_set.length ? details_set[0] : null;

    if (!details) {
      log.warn(`Purchase order not found for oid: ${purchaseOid}`);
      return res.status(404).json({
        code: 404,
        message: "Purchase order not found",
        data: null,
      });
    }

    const products_set = await get_data(productsSql);
    const stats_set = await get_data(statsSql);
    const stats = stats_set.length ? stats_set[0] : null;
    const activity_set = await getLogActivities(
      "purchase-order",
      purchaseOid,
      10,
    );

    log.info(`Purchase order details found for oid: ${purchaseOid}`);
    return res.status(200).json({
      code: 200,
      message: "Purchase order details found",
      data: {
        details,
        products: products_set.length ? products_set : [],
        stats: {
          totalProducts: parseInt(stats?.totalproducts) || 0,
          totalAmount: parseFloat(stats?.totalamount) || 0,
          paidAmount: parseFloat(stats?.paidamount) || 0,
          paymentProgress: parseFloat(stats?.paymentprogress) || 0,
          verifiedItems: parseInt(stats?.verifieditems) || 0,
          pendingVerification: parseInt(stats?.pendingverification) || 0,
        },
        activity: activity_set.map((activity) => ({
          date: activity.performed_on,
          user: activity.performed_by,
          action: activity.title,
          description: activity.description,
        })),
      },
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting purchase order details: ${e?.message}`,
    );
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }
};

const generate_purchase_data_sql = (purchaseOid) => {
  const query = `SELECT pr.oid, pr.supplier_oid, pr.total_amount, pr.special_notes, pr.payment_status, pr.paid_amount, pr.purchase_type, pr.status, pr.created_by, to_char(pr.created_on, 'DD/MM/YYYY') as created_on, pr.cancelled_by, to_char(pr.cancelled_on, 'DD/MM/YYYY') as cancelled_on, pr.verified_by, to_char(pr.verified_on, 'DD/MM/YYYY') as verified_on, sup.name as supplier_name FROM ${TABLE.PURCHASE} pr LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pr.supplier_oid WHERE pr.oid = $1`;
  return { text: query, values: [purchaseOid] };
};

const generate_products_data_sql = (purchaseOid) => {
  const query = `SELECT pd.oid, pd.purchase_oid, pd.product_oid, pr.name as product_name, pd.warehouse_oid, wr.name as warehouse_name, pd.aisle_oid, ai.name as aisle_name, CAST(pd.ordered_quantity AS INTEGER) AS quantity, CAST(pd.ordered_unit_price as INTEGER) as unit_price, CAST(pd.verified_quantity AS INTEGER) AS verified_quantity, CAST(pd.verified_unit_price as INTEGER) as verified_unit_price, CAST(i.selling_price AS INTEGER) AS selling_price, CAST(i.maximum_discount AS INTEGER) AS maximum_discount, i.status, i.intended_use
      FROM ${TABLE.PURCHASE_DETAILS} pd
      LEFT JOIN ${TABLE.INVENTORY} i ON pd.oid = i.purchase_details_oid
      LEFT JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid
      LEFT JOIN ${TABLE.WAREHOUSE} wr ON wr.oid = pd.warehouse_oid
      LEFT JOIN ${TABLE.AISLE} ai ON ai.oid = pd.aisle_oid
      WHERE pd.purchase_oid = $1`;
  return { text: query, values: [purchaseOid] };
};

const generate_stats_sql = (purchaseOid) => {
  const query = `
      SELECT
            p.oid,
            COALESCE(COUNT(pd.oid), 0) as totalProducts,
            COALESCE(p.total_amount, 0) as totalAmount,
            COALESCE(p.paid_amount, 0) as paidAmount,
            CASE
                  WHEN COALESCE(p.total_amount, 0) > 0
                  THEN ROUND(((COALESCE(p.paid_amount, 0) / p.total_amount) * 100)::numeric, 2)
                  ELSE 0
            END as paymentProgress,
            COALESCE(COUNT(CASE WHEN COALESCE(pd.verified_quantity, 0) > 0 THEN 1 END), 0) as verifiedItems,
            COALESCE(COUNT(CASE WHEN COALESCE(pd.verified_quantity, 0) = 0 THEN 1 END), 0) as pendingVerification
      FROM ${TABLE.PURCHASE} p
      LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
      WHERE p.oid = $1
      GROUP BY p.oid, p.total_amount, p.paid_amount
  `;

  return { text: query, values: [purchaseOid] };
};

module.exports = get_purchase_order_details;
