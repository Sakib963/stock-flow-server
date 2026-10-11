const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { deductFreeStock, incrementProductStat } = require("../../utils/stock-movement");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Every line leaves in one transaction, only from free units (giveaway REQ-05, REQ-06). A gift given
// by mistake is not reversed: a stock adjustment puts the units back.
const give_giveaway = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const giveaway_no = await execute_transaction(async (tx) => {
            const given = await tx.execute_value({
                text: `UPDATE ${TABLE.GIVEAWAY} SET status = 'Given', given_by = $1, given_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Draft' RETURNING giveaway_no, recipient_name`,
                values: [user_id, oid],
            });
            if (given.rowCount !== 1) {
                const [row] = await tx.get_data({ text: `SELECT giveaway_no, status FROM ${TABLE.GIVEAWAY} WHERE oid = $1`, values: [oid] });
                if (!row) fail(404, "No giveaway with that number.");
                fail(409, `${row.giveaway_no} is already ${row.status === "Given" ? "given" : "cancelled"}. Reload it to see what changed.`, { status: row.status });
            }
            const { giveaway_no, recipient_name } = given.rows[0];
            const lines = await tx.get_data({
                text: `SELECT gl.inventory_oid, gl.product_oid, gl.quantity, p.name, i.batch_code
                         FROM ${TABLE.GIVEAWAY_LINE} gl JOIN ${TABLE.INVENTORY} i ON i.oid = gl.inventory_oid JOIN ${TABLE.PRODUCT} p ON p.oid = gl.product_oid
                        WHERE gl.giveaway_oid = $1 ORDER BY gl.inventory_oid`,
                values: [oid],
            });
            for (const line of lines) {
                const ok = await deductFreeStock(tx, { inventory_oid: line.inventory_oid, quantity: line.quantity, reason: "given_away", source_oid: oid, user_id });
                if (!ok) fail(409, `Not enough free ${line.name} in batch ${line.batch_code} to give ${line.quantity}. Units held for online orders cannot be given.`, { inventory_oid: line.inventory_oid });
                await incrementProductStat(tx, { product_oid: line.product_oid, column: "total_given_away", quantity: line.quantity, user_id });
            }
            await saveLogActivity({ reference_type: "giveaway", reference_oid: oid, title: "Giveaway given", description: `${giveaway_no} given to ${recipient_name}` }, { tx, request });
            return giveaway_no;
        });
        log.info(`Giveaway ${giveaway_no} given by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Giveaway given", data: { oid, giveaway_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while giving a giveaway: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The giveaway was not given. Try again in a moment." });
    }
};

module.exports = give_giveaway;
