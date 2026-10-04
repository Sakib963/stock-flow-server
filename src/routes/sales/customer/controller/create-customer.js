const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { insert_address, describe_address } = require("../utils/address");
const { phone_taken, phone_conflict } = require("../utils/duplicate");

const create_customer = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const oid = uuidv4();
    try {
        const address = await execute_transaction(async (tx) => {
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.CUSTOMERS} (oid, name, phone, phone_normalized, gender, age_band, first_source_oid, social_handle, note, created_by)
                       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
                values: [oid, payload.name, payload.phone, payload.gender, payload.age_band, payload.first_source_oid, payload.social_handle, payload.note, user_id],
            });
            await saveLogActivity({ reference_type: "customer", reference_oid: oid, title: "Created customer", description: `${payload.name}, ${payload.phone}` }, { tx, request });

            if (!payload.address) return null;
            const added = await insert_address(tx, oid, payload.address, user_id);
            await saveLogActivity({ reference_type: "customer", reference_oid: oid, title: "Added address", description: describe_address(payload.address) }, { tx, request });
            return added;
        });

        log.info(`Customer ${oid} created by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Customer saved", data: { oid, address_oid: address?.oid ?? null } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (phone_taken(e)) {
            const conflict = await phone_conflict(payload.phone).catch(() => null);
            if (conflict) return res.status(409).json(conflict);
        }
        if (e?.code === "23503") return res.status(400).json({ code: 400, message: "That source no longer exists. Pick another source.", data: { field: "first_source_oid" } });
        log.error(`An exception occurred while creating a customer: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the customer. Try again in a moment." });
    }
};

module.exports = create_customer;
