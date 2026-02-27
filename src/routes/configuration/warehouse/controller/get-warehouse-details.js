const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_warehouse_details = async (request, res) => {
  try {
    const warehouseOid = request.params.oid;

    // Get warehouse details
    const detailsSql = generate_details_sql(warehouseOid);
    const details_set = await get_data(detailsSql);
    const details = details_set.length ? details_set[0] : null;

    if (!details) {
      log.warn(`Warehouse not found for oid: ${warehouseOid}`);
      return res.status(404).json({
        code: 404,
        message: "Warehouse not found",
        data: null,
      });
    }

    // Get warehouse statistics
    const statsSql = generate_stats_sql(warehouseOid);
    const stats_set = await get_data(statsSql);
    const stats = stats_set.length
      ? stats_set[0]
      : {
          totalProducts: 0,
          totalAisles: 0,
          totalInventoryValue: 0,
          totalQuantity: 0,
          utilizationPercentage: 0,
        };

    // Get activity timeline
    const activity_set = await getLogActivities("warehouse", warehouseOid, 10);

    // Combine all data
    const responseData = {
      details: details,
      stats: {
        totalProducts: parseInt(stats.totalproducts) || 0,
        totalAisles: parseInt(stats.totalaisles) || 0,
        totalInventoryValue: parseFloat(stats.totalinventoryvalue) || 0,
        totalQuantity: parseInt(stats.totalquantity) || 0,
        utilizationPercentage: parseFloat(stats.utilizationpercentage) || 0,
      },
      activity: activity_set,
    };

    log.info(`Warehouse details found for oid: ${warehouseOid}`);
    return res.status(200).json({
      code: 200,
      message: "Warehouse details found successfully",
      data: responseData,
    });
  } catch (e) {
    log.error(
      `An exception occurred while getting warehouse details: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_details_sql = (warehouseOid) => {
  const query = `
            SELECT
                  w.oid,
                  w.name,
                  w.code,
                  w.location,
                  w.capacity,
                  w.status,
                  w.created_by,
                  w.created_on,
                  w.edited_by,
                  w.edited_on
            FROM ${TABLE.WAREHOUSE} w
            WHERE w.oid = $1
      `;
  return { text: query, values: [warehouseOid] };
};

const generate_stats_sql = (warehouseOid) => {
  const query = `
            SELECT
                  COUNT(DISTINCT i.product_oid) as totalProducts,
                  COUNT(DISTINCT pd.aisle_oid) as totalAisles,
                  COALESCE(SUM(i.quantity_available * i.selling_price), 0) as totalInventoryValue,
                  COALESCE(SUM(i.quantity_available), 0) as totalQuantity,
                  0 as utilizationPercentage
            FROM ${TABLE.PURCHASE_DETAILS} pd
            LEFT JOIN ${TABLE.INVENTORY} i ON i.purchase_details_oid = pd.oid
            WHERE pd.warehouse_oid = $1
      `;
  return { text: query, values: [warehouseOid] };
};

module.exports = get_warehouse_details;
