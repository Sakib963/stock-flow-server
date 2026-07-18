const { TABLE } = require("../../../../utils/constant");
const { execute_values, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

const create_product_dispose = async (request, res) => {
  const payload = request.body;
  const user_id = request.credentials.user_id;
  let dispose_oid;

  try {
    const products = payload.products || [];
    if (!products.length) {
      return res.status(400).json({
        code: 400,
        message: "At least one product line is required to dispose",
      });
    }

    // Snapshot cost_price and validate batches server-side (never trust client cost)
    const inventoryOids = [...new Set(products.map((p) => p.inventory_oid))];
    const inventoryRows = await get_data({
      text: `SELECT oid, product_oid, cost_price, quantity_available FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
      values: [inventoryOids],
    });
    const inventoryByOid = new Map(inventoryRows.map((row) => [row.oid, row]));

    for (const product of products) {
      const batch = inventoryByOid.get(product.inventory_oid);
      if (!batch) {
        return res.status(400).json({
          code: 400,
          message: "One or more selected batches no longer exist",
        });
      }
      if (batch.product_oid !== product.product_oid) {
        return res.status(400).json({
          code: 400,
          message: "Product/batch mismatch in dispose payload",
        });
      }
    }

    let total_dispose_quantity = 0;
    let total_dispose_value = 0;
    const dispose_details_sql = [];
    dispose_oid = uuidv4();

    products.forEach((product) => {
      const batch = inventoryByOid.get(product.inventory_oid);
      const cost_price = Number(batch.cost_price) || 0;
      const quantity = Number(product.dispose_quantity) || 0;
      total_dispose_quantity += quantity;
      total_dispose_value += cost_price * quantity;

      dispose_details_sql.push({
        text: `INSERT INTO ${TABLE.DISPOSE_DETAILS} (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        values: [
          uuidv4(),
          dispose_oid,
          product.product_oid,
          product.inventory_oid,
          quantity,
          product.reason,
          cost_price,
          product.line_note || null,
          user_id,
        ],
      });
    });

    const dispose_no = await generate_unique_dispose_no();

    const dispose_sql = {
      text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE} (oid, dispose_no, disposal_date, disposal_method, total_dispose_quantity, total_dispose_value, notes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      values: [
        dispose_oid,
        dispose_no,
        payload.disposal_date,
        payload.disposal_method,
        total_dispose_quantity,
        total_dispose_value,
        payload.notes || null,
        "Submitted",
        user_id,
      ],
    };

    await execute_values([dispose_sql, ...dispose_details_sql]);

    saveLogActivity({
      reference_type: "product-dispose",
      reference_oid: dispose_oid,
      title: "Dispose Created",
      description: `Disposal ${dispose_no} created with ${products.length} line item(s), pending approval`,
      performed_by: user_id,
    });
  } catch (e) {
    log.error(
      `An exception occurred while creating product dispose: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something Went Wrong! Please try again later!",
    });
  }

  log.info(`Product dispose created successfully by: ${user_id}`);
  return res.status(200).json({
    code: 200,
    message: "Product Dispose Created Successfully!",
    data: { oid: dispose_oid },
  });
};

const generate_unique_dispose_no = async () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let dispose_no;
  let is_unique = false;
  while (!is_unique) {
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    dispose_no = `DISP-${suffix}`;
    const existing = await get_data({
      text: `SELECT COUNT(oid)::int4 AS total FROM ${TABLE.PRODUCT_DISPOSE} WHERE dispose_no = $1`,
      values: [dispose_no],
    });
    is_unique = existing[0].total === 0;
  }
  return dispose_no;
};

module.exports = create_product_dispose;
