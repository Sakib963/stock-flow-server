const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { caller_for, lock_target, read_role, not_self, not_last_owner, contact_taken, taken_by_index } = require("../utils/user-rules");

const FIELDS = { name: "Name", mobile_number: "Phone", designation: "Designation", photo: "Photo" };

// A new role applies from the person's next request. Permissions are cached by config version, so a
// role change raises it; the boot payload's ETag moves with edited_on. Nobody is signed out.
const update_user = async (request, res) => {
    const { oid, version, role_oid, ...fields } = request.body;
    let changed = false;
    try {
        const caller = await caller_for(request);
        await execute_transaction(async (tx) => {
            const target = await lock_target(tx, oid, caller);
            if (target.version !== version) fail(409, "Someone changed this person while you were editing. Their current details are loaded; check them and save again.");

            const edited = Object.keys(FIELDS).filter((key) => (fields[key] ?? null) !== (target[key] ?? null));
            const role_changed = role_oid !== target.role_oid;
            if (!edited.length && !role_changed) return;

            let role = null;
            if (role_changed) {
                not_self(target, caller, "change the role of");
                await not_last_owner(tx, target, "change the role of");
                role = await read_role(tx, role_oid, caller);
            }
            if (edited.includes("mobile_number")) await contact_taken(tx, { mobile_number: fields.mobile_number, oid });

            await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET name = $2, mobile_number = $3, designation = $4, photo = $5, role_oid = $6, edited_by = $7, edited_on = clock_timestamp() WHERE oid = $1`,
                values: [oid, fields.name, fields.mobile_number, fields.designation, fields.photo, role_oid, caller.user_id],
            });
            if (role) await bump_config_version(tx);
            const parts = [edited.length ? `Changed ${edited.map((key) => FIELDS[key]).join(", ")}` : null, role ? `Role changed from ${target.role_name ?? "none"} to ${role.name}` : null].filter(Boolean);
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: role ? "Changed role" : "Edited user", description: `${fields.name}. ${parts.join(". ")}.` }, { tx, request });
            changed = true;
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        const taken = taken_by_index(e);
        if (taken) return res.status(409).json({ code: 409, message: taken.message, data: { field: taken.field } });
        log.error(`An exception occurred while updating user ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save this person. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: changed ? "User saved" : "Nothing changed", data: { oid, changed } });
};

module.exports = update_user;
