const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { caller_of } = require("../utils/role-grants");

// An Inactive role grants nothing: its holders pass no permission check from their next request.
const switch_role_status = async (request, res) => {
    const { oid, status } = request.body;
    try {
        const caller = await caller_of(request);
        await execute_transaction(async (tx) => {
            const [role] = await tx.get_data({ text: `SELECT name, scope, is_system, status FROM ${TABLE.ROLE} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!role || (role.scope === "system" && !caller.system)) fail(404, "That role does not exist.");
            if (role.is_system) fail(400, `The ${role.name} role is always on.`);
            if (role.status === status) return;
            if (status === "Inactive") {
                const [own] = await tx.get_data({ text: `SELECT 1 FROM ${TABLE.LOGIN} WHERE role_oid = $1 AND email = $2`, values: [oid, caller.user_id] });
                if (own) fail(400, "You hold this role. Turning it off would take your own access, including this page. Ask someone else to do it.");
            }

            await tx.execute_value({ text: `UPDATE ${TABLE.ROLE} SET status = $2, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $1`, values: [oid, status, caller.user_id] });
            await bump_config_version(tx);
            await saveLogActivity({ reference_type: "role", reference_oid: oid, title: status === "Active" ? "Turned role on" : "Turned role off", description: role.name }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while switching role ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not change the role. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: status === "Active" ? "Role turned on" : "Role turned off", data: { oid, status } });
};

module.exports = switch_role_status;
