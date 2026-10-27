const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { refuse_stale } = require("../../../../db/stale-edit");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { duplicate_name } = require("../utils/duplicate");

const GONE = "That partner no longer exists. It may have been removed.";

const update_partner_details = async (request, res) => {
    const p = request.body;
    const user_id = request.credentials.user_id;
    let changed = true;
    try {
        await execute_transaction(async (tx) => {
            await refuse_stale(tx, { table: TABLE.PARTNER, oid: p.oid, version: p.version, gone: GONE });
            const rows = await tx.get_data({
                text: `SELECT name, partner_type, platforms, handle, phone_number, payment_method, payment_account, note, status FROM ${TABLE.PARTNER} WHERE oid = $1 FOR UPDATE`,
                values: [p.oid],
            });
            if (!rows.length) fail(404, GONE);

            // Saving an untouched form writes nothing, so the timeline records only real changes.
            const changes = detectChanges({ ...rows[0], platforms: rows[0].platforms.join(", ") }, { ...p, platforms: p.platforms.join(", ") });
            if (!changes.length) {
                changed = false;
                return;
            }

            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.PARTNER} SET name = $1, partner_type = $2, platforms = $3, handle = $4, phone_number = $5, payment_method = $6, payment_account = $7, note = $8, status = $9,
                              edited_by = $10, edited_on = clock_timestamp()
                        WHERE oid = $11`,
                values: [p.name, p.partner_type, p.platforms, p.handle, p.phone_number, p.payment_method, p.payment_account, p.note, p.status, user_id, p.oid],
            });
            if (updated.rowCount !== 1) fail(404, GONE);
            await saveLogActivity({ reference_type: "partner", reference_oid: p.oid, title: "Updated partner", description: generateChangeDescription(`partner "${p.name}"`, changes) }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        const taken = duplicate_name(e);
        if (taken) return res.status(409).json({ code: 409, message: taken.message, data: { field: taken.field } });
        log.error(`An exception occurred while updating partner ${p.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the partner. Try again in a moment." });
    }

    if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
    return res.status(200).json({ code: 200, message: "Partner updated", data: { changed: true } });
};

module.exports = update_partner_details;
