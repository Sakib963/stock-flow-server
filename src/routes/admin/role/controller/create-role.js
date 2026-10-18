const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { caller_of, plan_grants, read_catalogue, write_grants, name_taken, describe_change } = require("../utils/role-grants");

const create_role = async (request, res) => {
    const { name, description, codes } = request.body;
    const oid = uuidv4();
    try {
        const caller = await caller_of(request);
        await execute_transaction(async (tx) => {
            await name_taken(tx, name);
            const catalogue = await read_catalogue(tx);
            const { added } = plan_grants({ catalogue, caller, current: new Set(), submitted: codes, scope: "business", is_system_admin_role: false });

            await tx.execute_value({
                text: `INSERT INTO ${TABLE.ROLE} (oid, name, description, scope, status, created_by) VALUES ($1, $2, $3, 'business', 'Active', $4)`,
                values: [oid, name, description, caller.user_id],
            });
            await write_grants(tx, { role_oid: oid, catalogue, added, removed: [], user_id: caller.user_id });
            await bump_config_version(tx);
            await saveLogActivity({ reference_type: "role", reference_oid: oid, title: "Created role", description: `${name}. ${describe_change(catalogue, added, [])}` }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (e?.code === "23505" && e.constraint === "role_name_unique") return res.status(409).json({ code: 409, message: "A role with this name already exists. Choose another name.", data: { field: "name" } });
        log.error(`An exception occurred while creating role ${name}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not create the role. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "Role created", data: { oid } });
};

module.exports = create_role;
