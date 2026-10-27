const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { caller_for, read_role, contact_taken, taken_by_index } = require("../utils/user-rules");

// The password is temporary: must_change_password makes the person set their own before anything
// else, so whoever created the account never knows the one they use.
const create_user = async (request, res) => {
    const { name, email, mobile_number, designation, photo, role_oid, password } = request.body;
    const oid = uuidv4();
    try {
        const caller = await caller_for(request);
        const hashed = await bcrypt.hash(password, 10);
        const role = await execute_transaction(async (tx) => {
            const role = await read_role(tx, role_oid, caller);
            await contact_taken(tx, { email, mobile_number });
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.LOGIN} (oid, email, password, name, mobile_number, designation, photo, role_oid, status, must_change_password, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active', true, $9)`,
                values: [oid, email, hashed, name, mobile_number, designation, photo, role_oid, caller.user_id],
            });
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: "Created user", description: `${name} (${email}) with the ${role.name} role.` }, { tx, request });
            return role;
        });
        log.info(`User ${email} created with role ${role.name}`);
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        const taken = taken_by_index(e);
        if (taken) return res.status(409).json({ code: 409, message: taken.message, data: { field: taken.field } });
        log.error(`An exception occurred while creating a user: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not create the user. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "User created", data: { oid } });
};

module.exports = create_user;
