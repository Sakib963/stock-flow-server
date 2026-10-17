const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { duplicate_name } = require("../utils/duplicate");

const create_partner = async (request, res) => {
    const p = request.body;
    const user_id = request.credentials.user_id;
    const oid = uuidv4();
    try {
        await execute_transaction(async (tx) => {
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.PARTNER} (oid, name, partner_type, platforms, handle, phone_number, payment_method, payment_account, note, status, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                values: [oid, p.name, p.partner_type, p.platforms, p.handle, p.phone_number, p.payment_method, p.payment_account, p.note, p.status, user_id],
            });
            await saveLogActivity({ reference_type: "partner", reference_oid: oid, title: "Created partner", description: `Created partner "${p.name}" (${p.partner_type})` }, { tx, request });
        });
        log.info(`Partner ${p.name} created by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Partner created", data: { oid } });
    } catch (e) {
        const taken = duplicate_name(e);
        if (taken) return res.status(409).json({ code: 409, message: taken.message, data: { field: taken.field } });
        log.error(`An exception occurred while creating a partner: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the partner. Try again in a moment." });
    }
};

module.exports = create_partner;
