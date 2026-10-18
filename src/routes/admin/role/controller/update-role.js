const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { caller_of, plan_grants, read_catalogue, write_grants, name_taken, describe_change, VERSION } = require("../utils/role-grants");

// Every holder gets the new grants on their next request: permissions are read through the role and
// cached by config version, which this raises.
const update_role = async (request, res) => {
    const { oid, name, description, codes, version } = request.body;
    let result = { changed: false };
    try {
        const caller = await caller_of(request);
        await execute_transaction(async (tx) => {
            const [role] = await tx.get_data({ text: `SELECT r.name, r.description, r.scope, r.is_system, ${VERSION} AS version FROM ${TABLE.ROLE} r WHERE r.oid = $1 FOR UPDATE`, values: [oid] });
            if (!role || (role.scope === "system" && !caller.system)) fail(404, "That role does not exist.");
            if (role.is_system && !caller.system) fail(403, `Only the system admin changes the ${role.name} role.`);

            const current = new Set((await tx.get_data({ text: `SELECT p.code FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid WHERE rp.role_oid = $1`, values: [oid] })).map((r) => r.code));
            if (role.version !== version) fail(409, "Someone changed this role while you were editing it. Its current access is loaded; check it and save again.", { codes: [...current] });
            if (role.is_system && name !== role.name) fail(400, `The ${role.name} role cannot be renamed.`);
            if (name !== role.name) await name_taken(tx, name, oid);

            const catalogue = await read_catalogue(tx);
            const { added, removed } = plan_grants({ catalogue, caller, current, submitted: codes, scope: role.scope, is_system_admin_role: role.is_system && role.scope === "system" });
            const renamed = name !== role.name || (description ?? null) !== (role.description ?? null);
            if (!renamed && !added.length && !removed.length) return;

            await tx.execute_value({ text: `UPDATE ${TABLE.ROLE} SET name = $2, description = $3, edited_by = $4, edited_on = clock_timestamp() WHERE oid = $1`, values: [oid, name, description, caller.user_id] });
            await write_grants(tx, { role_oid: oid, catalogue, added, removed, user_id: caller.user_id });
            await bump_config_version(tx);

            const [{ holders }] = await tx.get_data({ text: `SELECT COUNT(*)::int AS holders FROM ${TABLE.LOGIN} WHERE role_oid = $1`, values: [oid] });
            const parts = [name !== role.name ? `Renamed from "${role.name}" to "${name}"` : null, (description ?? null) !== (role.description ?? null) ? "Description changed" : null, describe_change(catalogue, added, removed) || null, `${holders} ${holders === 1 ? "person holds" : "people hold"} this role`];
            await saveLogActivity({ reference_type: "role", reference_oid: oid, title: "Updated role", description: parts.filter(Boolean).join(". ") }, { tx, request });
            result = { changed: true, added, removed, holders };
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (e?.code === "23505" && e.constraint === "role_name_unique") return res.status(409).json({ code: 409, message: "A role with this name already exists. Choose another name.", data: { field: "name" } });
        log.error(`An exception occurred while updating role ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the role. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: result.changed ? "Role saved" : "Nothing changed.", data: result });
};

module.exports = update_role;
