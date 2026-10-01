const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

const REASON_LABEL = { damaged: "Damaged", expired: "Expired", spoiled: "Spoiled", sample: "Sample", quality_reject: "Faulty from supplier", other: "Other" };
const METHOD_LABEL = { discarded: "Discarded", destroyed: "Destroyed", donated: "Donated", recycled: "Recycled", other: "Other" };

const line_fail = (index, message) => fail(400, `Line ${index + 1}: ${message}`, { field: "lines", line: index });

// Everything a line points at must exist and be in use. Submitting also checks that each line is
// complete, that Other says why, and that it takes no more than the batch has free of holds.
const check_lines = async (tx, lines, submitting) => {
      const product_oids = [...new Set(lines.map((line) => line.product_oid))];
      const products = await tx.get_data({ text: `SELECT oid, name FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND is_deleted = FALSE AND status = 'Active'`, values: [product_oids] });
      if (products.length !== product_oids.length) fail(400, "A product on this disposal was removed or made inactive. Take it off and save again.", { field: "lines" });

      const batch_oids = [...new Set(lines.map((line) => line.inventory_oid).filter(Boolean))];
      const batches = await tx.get_data({
            text: `SELECT i.oid, i.product_oid, i.batch_code,
                          (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free
                     FROM ${TABLE.INVENTORY} i WHERE i.oid = ANY($1)`,
            values: [batch_oids],
      });
      const batch_of = new Map(batches.map((b) => [b.oid, b]));

      lines.forEach((line, index) => {
            const batch = line.inventory_oid ? batch_of.get(line.inventory_oid) : null;
            if (line.inventory_oid && (!batch || batch.product_oid !== line.product_oid)) line_fail(index, "that batch is not one of this product's. Pick the batch again.");
            if (!submitting) return;
            if (line.reason === "other" && !line.line_note) line_fail(index, "say why in the line note when the reason is Other.");
            if (line.quantity > batch.free) line_fail(index, `batch ${batch.batch_code} has only ${Math.max(batch.free, 0)} free to dispose. Lower the quantity.`);
      });
};

// The batch's cost is written on the line when it is saved, so the loss keeps its value.
const insert_lines = async (tx, dispose_oid, lines, user_id, new_oid) => {
      for (const line of lines) {
            await tx.execute_value({
                  text: `INSERT INTO ${TABLE.DISPOSE_DETAILS} (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by, created_on)
                         VALUES ($1, $2, $3, $4::varchar, $5, $6, (SELECT cost_price FROM ${TABLE.INVENTORY} WHERE oid = $4::varchar), $7, $8, clock_timestamp())`,
                  values: [new_oid(), dispose_oid, line.product_oid, line.inventory_oid, line.quantity, line.reason, line.line_note, user_id],
            });
      }
};

const delete_lines = (tx, dispose_oid) => tx.execute_value({ text: `DELETE FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`, values: [dispose_oid] });

// The header keeps its totals, as a disposal a customer return makes writes them too.
const write_totals = (tx, dispose_oid) =>
      tx.execute_value({
            text: `UPDATE ${TABLE.PRODUCT_DISPOSE} d
                      SET total_dispose_quantity = t.units, total_dispose_value = t.value
                     FROM (SELECT COALESCE(SUM(dispose_quantity), 0) AS units, COALESCE(SUM(dispose_quantity * COALESCE(cost_price, 0)), 0) AS value FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1) t
                    WHERE d.oid = $1`,
            values: [dispose_oid],
      });

const units = (lines) => lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);

const describe = (number, lines) => `${number}: ${lines.length} line${lines.length === 1 ? "" : "s"}, ${units(lines)} units`;

module.exports = { REASON_LABEL, METHOD_LABEL, check_lines, insert_lines, delete_lines, write_totals, describe };
