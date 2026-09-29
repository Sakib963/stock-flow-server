const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { resolveAmountPaid } = require("../../../sales/utils/order-utils");

// The total is the lines, never a figure the client sends: the old form sent its own and four orders
// were saved with a total their lines did not add up to.
// A draft line may still lack its quantity or price, and counts for nothing until it has both.
const order_total = (products) => products.reduce((sum, line) => sum + (line.quantity ?? 0) * (line.unit_price ?? 0), 0);

// payment_status is authoritative. A partial payment is more than nothing and less than the total;
// anything else is a different status, and saying so beats storing an order marked partially paid
// with the whole amount against it.
const resolve_paid = ({ payment_status, paid_amount }, total_amount) => {
      if (payment_status === "partially_paid" && !(paid_amount > 0 && paid_amount < total_amount)) {
            fail(400, "A partial payment must be more than 0 and less than the order total. Choose Paid or Unpaid instead.", { field: "paid_amount" });
      }
      return resolveAmountPaid({ payment_status, total_amount, amount_paid: paid_amount });
};

// A draft's payment is kept as typed, or left empty: its lines may not add up to a total yet, and
// submitting it runs resolve_paid.
const draft_paid = ({ payment_status, paid_amount }, total_amount) => {
      if (!payment_status) return 0;
      if (payment_status === "partially_paid") return Math.max(Number(paid_amount ?? 0), 0);
      return resolveAmountPaid({ payment_status, total_amount, amount_paid: paid_amount });
};

// Everything a line points at must exist and be in use, and an aisle must be in the line's own
// warehouse: stock received into warehouse B on an aisle of warehouse A counted toward both.
const check_references = async (tx, payload) => {
      const [supplier] = await tx.get_data({ text: `SELECT status FROM ${TABLE.SUPPLIER} WHERE oid = $1`, values: [payload.supplier_oid] });
      if (!supplier) fail(400, "That supplier no longer exists. Pick another.", { field: "supplier_oid" });
      if (supplier.status !== "Active") fail(400, "That supplier is inactive. Make it active or pick another.", { field: "supplier_oid" });

      const product_oids = [...new Set(payload.products.map((line) => line.product_oid))];
      const products = await tx.get_data({ text: `SELECT oid, name FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND is_deleted = FALSE AND status = 'Active'`, values: [product_oids] });
      if (products.length !== product_oids.length) fail(400, "A product on this order was removed or made inactive. Take it off the order and save again.", { field: "products" });

      const warehouse_oids = [...new Set(payload.products.map((line) => line.warehouse_oid).filter(Boolean))];
      const warehouses = await tx.get_data({ text: `SELECT oid FROM ${TABLE.WAREHOUSE} WHERE oid = ANY($1) AND status = 'Active'`, values: [warehouse_oids] });
      if (warehouses.length !== warehouse_oids.length) fail(400, "A warehouse on this order is inactive or was removed. Pick another.", { field: "products" });

      const aisle_oids = [...new Set(payload.products.map((line) => line.aisle_oid).filter(Boolean))];
      if (aisle_oids.length) {
            const aisles = await tx.get_data({ text: `SELECT oid, warehouse_oid FROM ${TABLE.AISLE} WHERE oid = ANY($1) AND status = 'Active'`, values: [aisle_oids] });
            const warehouse_of = new Map(aisles.map((aisle) => [aisle.oid, aisle.warehouse_oid]));
            for (const line of payload.products) {
                  if (line.aisle_oid && line.warehouse_oid && warehouse_of.get(line.aisle_oid) !== line.warehouse_oid) {
                        fail(400, "An aisle on this order is not in the warehouse chosen for its line. Pick an aisle of that warehouse.", { field: "products" });
                  }
            }
      }
};

const insert_lines = async (tx, purchase_oid, products, new_oid) => {
      for (const line of products) {
            await tx.execute_value({
                  text: `INSERT INTO ${TABLE.PURCHASE_DETAILS} (oid, purchase_oid, product_oid, warehouse_oid, aisle_oid, ordered_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  values: [new_oid(), purchase_oid, line.product_oid, line.warehouse_oid, line.aisle_oid, line.quantity, line.unit_price],
            });
      }
};

// One code per product received, B-YYMMDD-NNNN, the number from a sequence so two deliveries verified
// at the same moment cannot share one (2026-09-29-purchase-order-port.sql). FM9999990000 pads to four
// digits and widens past 9999.
const NEXT_BATCH_CODE = `'B-' || to_char(clock_timestamp(), 'YYMMDD') || '-' || to_char(nextval('inventory_batch_code_seq'), 'FM9999990000')`;

// Activity descriptions are read by people: 1,48,250 rather than 148250.
const taka = (amount) => Number(amount).toLocaleString("en-IN");

module.exports = { taka, order_total, resolve_paid, draft_paid, check_references, insert_lines, NEXT_BATCH_CODE };
