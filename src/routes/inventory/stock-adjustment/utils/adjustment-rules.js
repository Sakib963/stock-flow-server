const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { BUDGETS, has_budget, save_budget } = require("../../utils/cost-budget");

// Each reason says which way stock moved, so the loss figures stay honest. Entry error is the one
// that goes either way, and Opening stock only ever creates batches.
const DIRECTION = { opening_stock: "in", found: "in", lost: "out", theft: "out", entry_error: null };

const NEW_BATCH_FIELDS = ["cost_price", "intended_use", "selling_price", "maximum_discount", "warehouse_oid", "aisle_oid", "expiry_date", ...BUDGETS, "cost_remarks"];

// The direction comes from the reason where it can, and a line that takes from or adds to an existing
// batch carries none of a new batch's fields, so nothing half typed is kept against the wrong kind.
const shape_lines = (reason, lines) =>
      lines.map((line) => {
            const direction = DIRECTION[reason] ?? line.direction;
            const existing = reason !== "opening_stock" && (direction === "out" || !!line.inventory_oid);
            const shaped = { ...line, direction, inventory_oid: reason === "opening_stock" ? null : line.inventory_oid };
            if (existing) for (const key of NEW_BATCH_FIELDS) shaped[key] = null;
            if (!existing && shaped.intended_use !== "for_sale") Object.assign(shaped, { selling_price: null, maximum_discount: null });
            return shaped;
      });

const line_fail = (index, message) => fail(400, `Line ${index + 1}: ${message}`, { field: "lines", line: index });

// Everything a line points at must exist and be in use. A Draft is checked only for that; submitting
// also checks that every line is complete for its reason, and that a decrease still fits the batch.
const check_lines = async (tx, lines, submitting) => {
      const product_oids = [...new Set(lines.map((line) => line.product_oid))];
      const products = await tx.get_data({ text: `SELECT oid, name, has_expiry FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND is_deleted = FALSE AND status = 'Active'`, values: [product_oids] });
      if (products.length !== product_oids.length) fail(400, "A product on this adjustment was removed or made inactive. Take it off and save again.", { field: "lines" });
      const product_of = new Map(products.map((p) => [p.oid, p]));

      const batch_oids = [...new Set(lines.map((line) => line.inventory_oid).filter(Boolean))];
      const batches = await tx.get_data({
            text: `SELECT i.oid, i.product_oid, i.batch_code, i.quantity_available::int AS on_hand,
                          (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free
                     FROM ${TABLE.INVENTORY} i WHERE i.oid = ANY($1)`,
            values: [batch_oids],
      });
      const batch_of = new Map(batches.map((b) => [b.oid, b]));

      const warehouse_oids = [...new Set(lines.map((line) => line.warehouse_oid).filter(Boolean))];
      const warehouses = await tx.get_data({ text: `SELECT oid FROM ${TABLE.WAREHOUSE} WHERE oid = ANY($1) AND status = 'Active'`, values: [warehouse_oids] });
      if (warehouses.length !== warehouse_oids.length) fail(400, "A warehouse on this adjustment is inactive or was removed. Pick another.", { field: "lines" });
      const aisle_oids = [...new Set(lines.map((line) => line.aisle_oid).filter(Boolean))];
      const aisles = await tx.get_data({ text: `SELECT oid, warehouse_oid FROM ${TABLE.AISLE} WHERE oid = ANY($1) AND status = 'Active'`, values: [aisle_oids] });
      const warehouse_of = new Map(aisles.map((aisle) => [aisle.oid, aisle.warehouse_oid]));

      lines.forEach((line, index) => {
            const batch = line.inventory_oid ? batch_of.get(line.inventory_oid) : null;
            if (line.inventory_oid && (!batch || batch.product_oid !== line.product_oid)) line_fail(index, "that batch is not one of this product's. Pick the batch again.");
            if (line.aisle_oid && (!warehouse_of.has(line.aisle_oid) || (line.warehouse_oid && warehouse_of.get(line.aisle_oid) !== line.warehouse_oid))) line_fail(index, "the aisle is not in the warehouse chosen. Pick an aisle of that warehouse.");
            if (!submitting) return;

            const product = product_of.get(line.product_oid);
            if (!line.direction) line_fail(index, "choose whether stock goes up or down.");
            if (line.direction === "out") {
                  if (!batch) line_fail(index, `choose which batch of ${product.name} the units come from.`);
                  if (line.quantity > batch.free) line_fail(index, `batch ${batch.batch_code} has only ${Math.max(batch.free, 0)} free to take. Lower the quantity.`);
                  return;
            }
            if (batch) return;
            if (line.cost_price === null) line_fail(index, `enter what one unit of ${product.name} cost.`);
            if (!line.warehouse_oid) line_fail(index, "choose the warehouse the stock is in.");
            if (!line.intended_use) line_fail(index, "choose whether the stock is for sale or for internal use.");
            if (line.intended_use === "for_sale") {
                  if (!(line.selling_price >= 1)) line_fail(index, `enter the selling price of ${product.name}.`);
                  if ((line.maximum_discount ?? 0) > line.selling_price) line_fail(index, "the maximum discount cannot be more than the selling price.");
            }
      });
};

// A new batch's budgets are kept against its line, so a draft holds them and verify needs no copy.
const insert_lines = async (tx, adjustment_oid, lines, user_id, new_oid) => {
      for (const line of lines) {
            const oid = new_oid();
            await tx.execute_value({
                  text: `INSERT INTO ${TABLE.STOCK_ADJUSTMENT_LINE} (oid, adjustment_oid, product_oid, direction, quantity, inventory_oid, cost_price, intended_use, selling_price, maximum_discount, warehouse_oid, aisle_oid, expiry_date, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                  values: [oid, adjustment_oid, line.product_oid, line.direction, line.quantity, line.inventory_oid, line.cost_price, line.intended_use, line.selling_price, line.maximum_discount, line.warehouse_oid, line.aisle_oid, line.expiry_date, user_id],
            });
            if (has_budget(line)) await save_budget(tx, { owner: "stock_adjustment_line_oid", owner_oid: oid, values: line, user_id });
      }
};

const delete_lines = async (tx, adjustment_oid) => {
      await tx.execute_value({ text: `DELETE FROM ${TABLE.COST_BUDGET} WHERE stock_adjustment_line_oid IN (SELECT oid FROM ${TABLE.STOCK_ADJUSTMENT_LINE} WHERE adjustment_oid = $1)`, values: [adjustment_oid] });
      await tx.execute_value({ text: `DELETE FROM ${TABLE.STOCK_ADJUSTMENT_LINE} WHERE adjustment_oid = $1`, values: [adjustment_oid] });
};

const REASON_LABEL = { opening_stock: "Opening stock", found: "Found", lost: "Lost", theft: "Theft", entry_error: "Entry error" };

const units = (lines) => lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);

module.exports = { DIRECTION, REASON_LABEL, shape_lines, check_lines, insert_lines, delete_lines, units };
