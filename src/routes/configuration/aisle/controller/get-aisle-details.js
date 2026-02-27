const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_aisle_details = async (request, res) => {
  try {
    const aisleOid = request.params.oid;

    // Get aisle details
    const detailsSql = generate_details_sql(aisleOid);
    const details_set = await get_data(detailsSql);
    const details = details_set.length ? details_set[0] : null;

    if (!details) {
      log.warn(`Aisle not found for oid: ${aisleOid}`);
      return res.status(404).json({
        code: 404,
        message: "Aisle not found",
        data: null,
      });
    }

    // Get aisle statistics
    const statsSql = generate_stats_sql(aisleOid);
    const stats_set = await get_data(statsSql);
    const stats = stats_set.length
      ? stats_set[0]
      : {
          totalProducts: 0,
          totalBatches: 0,
          totalInventoryValue: 0,
          totalQuantity: 0,
          utilizationPercentage: 0,
        };

    // Get activity timeline
    const activity_set = await getLogActivities("aisle", aisleOid, 10);

    // Combine all data
    const responseData = {
      details: details,
      stats: {
        totalProducts: parseInt(stats.totalproducts) || 0,
        totalBatches: parseInt(stats.totalbatches) || 0,
        totalInventoryValue: parseFloat(stats.totalinventoryvalue) || 0,
        totalQuantity: parseInt(stats.totalquantity) || 0,
        utilizationPercentage: parseFloat(stats.utilizationpercentage) || 0,
      },
      activity: activity_set,
    };

    log.info(`Aisle details found for oid: ${aisleOid}`);
    return res.status(200).json({
      code: 200,
      message: "Aisle details found successfully",
      data: responseData,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting aisle details: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_details_sql = (aisleOid) => {
  const query = `
            SELECT
                  a.oid,
                  a.name,
                  a.code,
                  a.warehouse_oid,
                  a.capacity,
                  a.type_of_storage,
                  a.special_notes,
                  a.status,
                  a.created_by,
                  a.created_on,
                  a.edited_by,
                  a.edited_on,
                  w.name as warehouse_name
            FROM ${TABLE.AISLE} a
            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
            WHERE a.oid = $1
      `;
  return { text: query, values: [aisleOid] };
};

const generate_stats_sql = (aisleOid) => {
  const query = `
            SELECT
                  COUNT(DISTINCT i.product_oid) as totalProducts,
                  COUNT(DISTINCT i.batch_code) as totalBatches,
                  COALESCE(SUM(i.quantity_available * i.selling_price), 0) as totalInventoryValue,
                  COALESCE(SUM(i.quantity_available), 0) as totalQuantity,
                  0 as utilizationPercentage
            FROM ${TABLE.PURCHASE_DETAILS} pd
            LEFT JOIN ${TABLE.INVENTORY} i ON i.purchase_details_oid = pd.oid
            WHERE pd.aisle_oid = $1
      `;
  return { text: query, values: [aisleOid] };
};

module.exports = get_aisle_details;
