const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { get_data, fail } = require("../../../../db/database");
const { permissions_for } = require("../../../../middleware/require-permission");

// Vendor work, never on a business role whatever the request says.
const is_restricted = (code) => code.startsWith("system.") || code === "administration.user.reset-password";

// Without these the system admin could lock themselves out of the fix.
const KEPT_BY_SYSTEM_ADMIN = ["administration.role.view", "administration.role.edit", "system.feature.view", "system.feature.edit"];

const VERSION = `to_char(COALESCE(r.edited_on, r.created_on), 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const feature_of = (code) => code.slice(0, code.lastIndexOf("."));
const verb = (action) => action.charAt(0).toUpperCase() + action.slice(1).replace(/-/g, " ");
const named = (p) => `${p.label}: ${verb(p.action)}${p.is_sensitive ? " (sensitive)" : ""}`;

const caller_of = async (request) => {
    const user_id = request.credentials.user_id;
    const [row] = await get_data({ text: `SELECT r.scope FROM ${TABLE.LOGIN} l JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid WHERE l.email = $1`, values: [user_id] });
    return { user_id, system: row?.scope === "system", held: await permissions_for(user_id) };
};

// The caller grants only what they hold; grants they cannot see are kept as they are, so an owner
// editing a role never strips an action they were not shown.
const plan_grants = ({ catalogue, caller, current, submitted, scope, is_system_admin_role }) => {
    const unknown = submitted.filter((code) => !catalogue.has(code));
    if (unknown.length) fail(400, `These actions do not exist: ${unknown.join(", ")}. Reload the page and try again.`);

    const added = submitted.filter((code) => !current.has(code));
    const not_held = added.filter((code) => !caller.held.has(code));
    if (not_held.length) fail(403, `You cannot grant an action you do not hold yourself: ${not_held.map((c) => named(catalogue.get(c))).join(", ")}.`);
    if (scope === "business" && added.some(is_restricted)) fail(403, "That action is for the system admin only and cannot be given to a business role.");

    const final = new Set([...submitted, ...[...current].filter((code) => !caller.held.has(code))]);
    if (!final.size) fail(400, "Tick at least one action. A role with nothing ticked opens an empty app.");

    for (const code of final) {
        const view = `${feature_of(code)}.view`;
        if (catalogue.has(view) && !final.has(view)) fail(400, `${catalogue.get(code).label} needs View before any other action. Tick View or clear the feature.`);
    }
    if (is_system_admin_role) {
        const lost = KEPT_BY_SYSTEM_ADMIN.filter((code) => catalogue.has(code) && !final.has(code));
        if (lost.length) fail(400, `System Admin always keeps ${lost.map((c) => named(catalogue.get(c))).join(", ")}, or nobody could undo this.`);
    }

    return { final, added: [...final].filter((c) => !current.has(c)), removed: [...current].filter((c) => !final.has(c)) };
};

const read_catalogue = async (tx) => new Map((await tx.get_data({ text: `SELECT oid, code, action, label, is_sensitive FROM ${TABLE.PERMISSION}` })).map((p) => [p.code, p]));

const write_grants = async (tx, { role_oid, catalogue, added, removed, user_id }) => {
    if (removed.length) {
        await tx.execute_value({ text: `DELETE FROM ${TABLE.ROLE_PERMISSION} WHERE role_oid = $1 AND permission_oid = ANY($2)`, values: [role_oid, removed.map((c) => catalogue.get(c).oid)] });
    }
    for (const code of added) {
        await tx.execute_value({
            text: `INSERT INTO ${TABLE.ROLE_PERMISSION} (oid, role_oid, permission_oid, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (role_oid, permission_oid) DO NOTHING`,
            values: [uuidv4(), role_oid, catalogue.get(code).oid, user_id],
        });
    }
};

const name_taken = async (tx, name, oid = null) => {
    const [row] = await tx.get_data({ text: `SELECT name FROM ${TABLE.ROLE} WHERE lower(trim(name)) = lower(trim($1)) AND oid IS DISTINCT FROM $2`, values: [name, oid] });
    if (row) fail(409, `A role called "${row.name}" already exists. Choose another name.`, { field: "name" });
};

const describe_change = (catalogue, added, removed) =>
    [added.length ? `Added ${added.map((c) => named(catalogue.get(c))).join(", ")}` : null, removed.length ? `Removed ${removed.map((c) => named(catalogue.get(c))).join(", ")}` : null].filter(Boolean).join(". ");

module.exports = { is_restricted, VERSION, caller_of, plan_grants, read_catalogue, write_grants, name_taken, describe_change };
