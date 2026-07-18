const { TABLE } = require("../../../../utils/constant");
const { execute_value, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

const cancel_product_dispose = async (request, res) => {
  try {
    const user_id = request.credentials.user_id;
    const dispose_oid = request.body.oid;

    const statusData = await get_data({
      text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`,
      values: [dispose_oid],
    });
    if (!statusData.length) {
      return res
        .status(404)
        .json({ code: 404, message: "Product dispose not found" });
    }
    if (statusData[0].status !== "Submitted") {
      return res.status(400).json({
        code: 400,
        message: "Only submitted disposals can be cancelled",
      });
    }

    await execute_value({
      text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET status = $1, cancelled_by = $2, cancelled_on = clock_timestamp() WHERE oid = $3`,
      values: ["Cancelled", user_id, dispose_oid],
    });

    saveLogActivity({
      reference_type: "product-dispose",
      reference_oid: dispose_oid,
      title: "Dispose Cancelled",
      description: "Disposal cancelled by requester",
      performed_by: user_id,
    });

    log.info(`Product dispose ${dispose_oid} cancelled by: ${user_id}`);
    return res.status(200).json({
      code: 200,
      message: "Product dispose cancelled successfully!",
      data: null,
    });
  } catch (e) {
    log.error(
      `An exception occurred while cancelling product dispose: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }
};

module.exports = cancel_product_dispose;
