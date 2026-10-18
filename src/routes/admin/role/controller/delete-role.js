const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { caller_of } = require("../utils/role-grants");

// Only a role nobody holds: a person without a role has no defined access.
const delete_role = async (request, res) => {
    const { oid } = request.body;
    try {
        const caller = await caller_of(request);
        await execute_transaction(async (tx) => {
            const [role] = await tx.get_data({ text: `SELECT name, scope, is_system FROM ${TABLE.ROLE} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!role || (role.scope === "system" && !caller.system)) fail(404, "That role does not exist.");
            if (role.is_system) fail(400, `The ${role.name} role cannot be deleted.`);
            const [{ holders }] = await tx.get_data({ text: `SELECT COUNT(*)::int AS holders FROM ${TABLE.LOGIN} WHERE role_oid = $1`, values: [oid] });
            if (holders) fail(409, `${holders} ${holders === 1 ? "person holds" : "people hold"} this role. Give them another role first.`, { holders });

            await tx.execute_value({ text: `DELETE FROM ${TABLE.ROLE_PERMISSION} WHERE role_oid = $1`, values: [oid] });
            await tx.execute_value({ text: `DELETE FROM ${TABLE.ROLE} WHERE oid = $1`, values: [oid] });
            await bump_config_version(tx);
            await saveLogActivity({ reference_type: "role", reference_oid: oid, title: "Deleted role", description: role.name }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while deleting role ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not delete the role. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "Role deleted", data: { oid } });
};

module.exports = delete_role;
