const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_dispose_details = async (request, res) => {
  try {
    const disposeOid = request.params.oid || request.query.oid;

    const details_set = await get_data(generate_details_sql(disposeOid));
    const details = details_set.length ? details_set[0] : null;

    if (!details) {
      log.warn(`Product dispose not found for oid: ${disposeOid}`);
      return res.status(404).json({
        code: 404,
        message: "Product dispose not found",
        data: null,
      });
    }

    const [lines_set, aggregate_set, by_reason_set, activity_set] =
      await Promise.all([
        get_data(generate_lines_sql(disposeOid)),
        get_data(generate_aggregate_sql(disposeOid)),
        get_data(generate_by_reason_sql(disposeOid)),
        getLogActivities("product-dispose", disposeOid, 10),
      ]);

    const aggregate = aggregate_set.length ? aggregate_set[0] : {};
    const byReason = by_reason_set.map((row) => ({
      reason: row.reason,
      quantity: parseInt(row.quantity) || 0,
      value: parseFloat(row.value) || 0,
    }));

    return res.status(200).json({
      code: 200,
      message: "Product dispose details found",
      data: {
        details,
        lines: lines_set.length ? lines_set : [],
        stats: {
          totalLossValue: parseFloat(aggregate.total_loss) || 0,
          totalQuantity: parseInt(aggregate.total_quantity) || 0,
          distinctProducts: parseInt(aggregate.distinct_products) || 0,
          lineCount: parseInt(aggregate.line_count) || 0,
          topReason: byReason.length ? byReason[0].reason : null,
          byReason,
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
      `An exception occurred while getting product dispose details: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

const generate_details_sql = (disposeOid) => {
  const query = `
      SELECT pd.oid, pd.dispose_no, pd.disposal_method, pd.notes, pd.status,
            CAST(pd.total_dispose_quantity AS INTEGER) AS total_dispose_quantity,
            CAST(pd.total_dispose_value AS INTEGER) AS total_dispose_value,
            to_char(pd.disposal_date, 'YYYY-MM-DD') as disposal_date,
            pd.created_by, to_char(pd.created_on, 'DD/MM/YYYY') as created_on,
            pd.approved_by, to_char(pd.approved_on, 'DD/MM/YYYY') as approved_on,
            pd.rejected_by, to_char(pd.rejected_on, 'DD/MM/YYYY') as rejected_on,
            pd.cancelled_by, to_char(pd.cancelled_on, 'DD/MM/YYYY') as cancelled_on,
            pd.reversed_by, to_char(pd.reversed_on, 'DD/MM/YYYY') as reversed_on
      FROM ${TABLE.PRODUCT_DISPOSE} pd
      WHERE pd.oid = $1`;
  return { text: query, values: [disposeOid] };
};

const generate_lines_sql = (disposeOid) => {
  const query = `
      SELECT dd.oid, dd.product_oid, p.name as product_name,
            dd.inventory_oid, i.batch_code,
            CAST(dd.dispose_quantity AS INTEGER) AS dispose_quantity,
            dd.reason,
            CAST(dd.cost_price AS INTEGER) AS cost_price,
            CAST(COALESCE(dd.cost_price, 0) * dd.dispose_quantity AS INTEGER) AS line_loss,
            dd.line_note
      FROM ${TABLE.DISPOSE_DETAILS} dd
      LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = dd.product_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = dd.inventory_oid
      WHERE dd.dispose_oid = $1
      ORDER BY dd.created_on ASC`;
  return { text: query, values: [disposeOid] };
};

const generate_aggregate_sql = (disposeOid) => {
  const query = `
      SELECT
            COUNT(dd.oid) AS line_count,
            COUNT(DISTINCT dd.product_oid) AS distinct_products,
            COALESCE(SUM(dd.dispose_quantity), 0) AS total_quantity,
            COALESCE(SUM(COALESCE(dd.cost_price, 0) * dd.dispose_quantity), 0) AS total_loss
      FROM ${TABLE.DISPOSE_DETAILS} dd
      WHERE dd.dispose_oid = $1`;
  return { text: query, values: [disposeOid] };
};

const generate_by_reason_sql = (disposeOid) => {
  const query = `
      SELECT dd.reason,
            COALESCE(SUM(dd.dispose_quantity), 0) AS quantity,
            COALESCE(SUM(COALESCE(dd.cost_price, 0) * dd.dispose_quantity), 0) AS value
      FROM ${TABLE.DISPOSE_DETAILS} dd
      WHERE dd.dispose_oid = $1
      GROUP BY dd.reason
      ORDER BY value DESC`;
  return { text: query, values: [disposeOid] };
};

module.exports = get_product_dispose_details;
