const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { v4: uuidv4 } = require("uuid");

const create_warehouse = async (request, res) => {
  let payload = request.body;
  let user_id = request.credentials.user_id;
  try {
    // Check Warehouse
    const existing_warehouse = await check_existing_warehouse(payload.name);
    if (existing_warehouse) {
      log.warn(`Warehouse already exists [${payload.name}]`);
      return res
        .status(409)
        .json({ code: 409, message: "Warehouse Already Exists!" });
    }

    const warehouseOid = uuidv4();
    const sql = {
      text: `INSERT INTO ${TABLE.WAREHOUSE} (oid, name, code, location, capacity, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      values: [
        warehouseOid,
        payload.name,
        payload.code,
        payload.location || null,
        payload.capacity || null,
        payload.status,
        user_id,
      ],
    };

    await execute_value(sql);

    // Log activity (non-blocking - fire and forget)
    saveLogActivity({
      reference_type: "warehouse",
      reference_oid: warehouseOid,
      title: "Created warehouse",
      performed_by: user_id,
      description: `Created warehouse "${payload.name}"`,
    });
  } catch (e) {
    log.error(`An exception occurred while creating warehouse : ${e?.message}`);
    return res
      .status(500)
      .json({
        code: 500,
        message: "Something Went Wrong! Please try again later!",
      });
  }

  log.info(`Warehouse ${payload.name} created successfully by : ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Warehouse Created Successfully!",
  });
};

const check_existing_warehouse = async (name) => {
  let count = 0;
  const sql = {
    text: `select count(oid)::int4 as total from ${TABLE.WAREHOUSE} where name = $1`,
    values: [name],
  };
  try {
    let data_set = await get_data(sql);
    count = data_set[0]["total"];
  } catch (e) {
    log.error(
      `An exception occurred while checking warehouse count : ${e?.message}`,
    );
    throw new Error(e);
  }
  return count;
};

module.exports = create_warehouse;
