const { TABLE } = require("../../../../utils/constant");
const { execute_value, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

const cancel_purchase_order = async (request, res) => {
  try {
    const user_id = request.credentials.user_id;
    const purchaseOid = request.query.oid;

    const statusSql = {
      text: `SELECT status FROM ${TABLE.PURCHASE} WHERE oid = $1`,
      values: [purchaseOid],
    };

    const statusData = await get_data(statusSql);
    if (!statusData.length) {
      return res
        .status(404)
        .json({ code: 404, message: "Purchase order not found" });
    }

    if (statusData[0].status !== "Submitted") {
      return res.status(400).json({
        code: 400,
        message: "Only submitted purchase orders can be cancelled",
      });
    }

    const purchaseSql = {
      text: `UPDATE ${TABLE.PURCHASE} SET status = $1, cancelled_by = $2, cancelled_on = clock_timestamp() WHERE oid = $3`,
      values: ["Cancelled", user_id, purchaseOid],
    };

    await execute_value(purchaseSql);

    saveLogActivity({
      reference_type: "purchase-order",
      reference_oid: purchaseOid,
      title: "Purchase Order Cancelled",
      description: "Purchase order cancelled by user",
      performed_by: user_id,
    });

    log.info(`Purchase order cancelled for oid: ${purchaseOid}`);
    return res.status(200).json({
      code: 200,
      message: "Purchase order cancelled successfully!",
      data: null,
    });
  } catch (e) {
    log.error(
      `An exception occurred while canceling purchase order: ${e?.message}`,
    );
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }
};

module.exports = cancel_purchase_order;
