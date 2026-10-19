const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { caller_of } = require("../../role/utils/role-grants");

const VERSION = `to_char(COALESCE(l.edited_on, l.created_on), 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const caller_for = async (request) => ({ ...(await caller_of(request)), login_oid: request.credentials.login_oid });

const IS_OWNER = `(r.is_system AND r.scope = 'business')`;

// Codes a role grants that the caller does not hold. Giving or touching such a role would reach past
// the caller's own access, the same line Roles draws for grants.
const beyond_reach = async (tx, role_oid, caller) =>
    (
        await tx.get_data({
            text: `SELECT p.code FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid WHERE rp.role_oid = $1 AND NOT (p.code = ANY($2::text[]))`,
            values: [role_oid, [...caller.held]],
        })
    ).map((r) => r.code);

const read_role = async (tx, role_oid, caller) => {
    const [role] = await tx.get_data({ text: `SELECT r.oid, r.name, r.scope, r.status, ${IS_OWNER} AS is_owner FROM ${TABLE.ROLE} r WHERE r.oid = $1`, values: [role_oid] });
    if (!role || (role.scope === "system" && !caller.system)) fail(404, "That role does not exist. Reload the page and pick another.", { field: "role_oid" });
    if (role.status !== "Active") fail(400, `The ${role.name} role is turned off. Pick another role or turn it on first.`, { field: "role_oid" });
    if ((await beyond_reach(tx, role_oid, caller)).length) fail(403, `The ${role.name} role holds access you do not have, so you cannot give it.`, { field: "role_oid" });
    return role;
};

// Locks the person being changed. A deleted or vendor account reads as absent.
const lock_target = async (tx, oid, caller) => {
    const [target] = await tx.get_data({
        text: `SELECT l.oid, l.email, l.name, l.mobile_number, l.designation, l.photo, l.status, l.role_oid, r.name AS role_name, r.scope, ${IS_OWNER} AS is_owner, ${VERSION} AS version
                 FROM ${TABLE.LOGIN} l LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
                WHERE l.oid = $1 FOR UPDATE OF l`,
        values: [oid],
    });
    if (!target || target.status === "Deleted" || (target.scope === "system" && !caller.system)) fail(404, "That person does not exist.");
    if (target.role_oid && (await beyond_reach(tx, target.role_oid, caller)).length) fail(403, `${target.name}'s role holds access you do not have, so you cannot change their account.`);
    return target;
};

const not_self = (target, caller, doing) => {
    if (target.oid === caller.login_oid) fail(400, `You cannot ${doing} your own account. Ask someone else who manages users.`);
};

const not_last_owner = async (tx, target, doing) => {
    if (!target.is_owner || target.status !== "Active") return;
    // Every active owner is locked before counting, so two owners turning each other off at once cannot both pass.
    const owners = await tx.get_data({ text: `SELECT oid FROM ${TABLE.LOGIN} WHERE role_oid = $1 AND status = 'Active' ORDER BY oid FOR UPDATE`, values: [target.role_oid] });
    if (!owners.some((owner) => owner.oid !== target.oid)) fail(400, `${target.name} is the only active owner. Make someone else an owner before you ${doing} this account.`);
};

const contact_taken = async (tx, { email, mobile_number, oid = null }) => {
    if (email) {
        const [row] = await tx.get_data({ text: `SELECT 1 FROM ${TABLE.LOGIN} WHERE lower(trim(email)) = lower(trim($1)) AND oid IS DISTINCT FROM $2`, values: [email, oid] });
        if (row) fail(409, "Someone already uses this email, now or in the past. Use another email.", { field: "email" });
    }
    if (mobile_number) {
        const [row] = await tx.get_data({ text: `SELECT 1 FROM ${TABLE.LOGIN} WHERE mobile_number = $1 AND status <> 'Deleted' AND oid IS DISTINCT FROM $2`, values: [mobile_number, oid] });
        if (row) fail(409, "Someone already uses this phone number. Use another number.", { field: "mobile_number" });
    }
};

// A unique index caught what the check above raced past.
const taken_by_index = (e) =>
    e?.code === "23505" && { login_email_unique: { message: "Someone already uses this email, now or in the past. Use another email.", field: "email" }, login_email_key: { message: "Someone already uses this email. Use another email.", field: "email" }, login_mobile_number_unique: { message: "Someone already uses this phone number. Use another number.", field: "mobile_number" } }[e.constraint];

module.exports = { VERSION, caller_for, IS_OWNER, beyond_reach, read_role, lock_target, not_self, not_last_owner, contact_taken, taken_by_index };
