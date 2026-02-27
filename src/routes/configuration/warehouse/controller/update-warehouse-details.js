const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const {
  saveLogActivity,
  detectChanges,
  generateChangeDescription,
} = require("../../../../utils/activity-logger");

const update_warehouse_details = async (request, res) => {
  let payload = request.body;
  let user_id = request.credentials.user_id;
  try {
    // Get old data for comparison
    const oldDataSql = {
      text: `SELECT name, code, location, capacity, status FROM ${TABLE.WAREHOUSE} WHERE oid = $1`,
      values: [payload.oid],
    };
    const oldData = await get_data(oldDataSql);
    const oldWarehouse = oldData.length ? oldData[0] : null;
    const sql = {
      text: `update ${TABLE.WAREHOUSE} set name = $1, code = $2, location = $3, capacity = $4, status = $5, edited_on = clock_timestamp(), edited_by = $6 where oid = $7`,
      values: [
        payload.name,
        payload.code,
        payload.location || null,
        payload.capacity || null,
        payload.status,
        user_id,
        payload.oid,
      ],
    };
    await execute_value(sql);

    // Automatically detect changes and generate description (non-blocking - fire and forget)
    if (oldWarehouse) {
      const changes = detectChanges(oldWarehouse, payload);
      const activityDescription = generateChangeDescription(
        `warehouse "${payload.name}"`,
        changes,
      );

      saveLogActivity({
        reference_type: "warehouse",
        reference_oid: payload.oid,
        title: "Updated warehouse",
        performed_by: user_id,
        description: activityDescription,
      });
    }
  } catch (e) {
    log.error(`An exception occurred while updating warehouse : ${e?.message}`);
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }

  log.info(`Warehouse ${payload.name} updated successfully by : ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Warehouse Updated Successfully!",
  });
};

module.exports = update_warehouse_details;
