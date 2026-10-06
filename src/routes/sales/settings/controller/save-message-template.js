const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// A message template the business words itself (sales REQ-90). No oid creates one; an oid edits it,
// and switching it off keeps it for later rather than deleting it.
const save_message_template = async (request, res) => {
    const { oid, name, language, body, order_statuses, status } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const saved = await execute_transaction(async (tx) => {
            const [clash] = await tx.get_data({
                text: `SELECT oid FROM ${TABLE.MESSAGE_TEMPLATE} WHERE lower(name) = lower($1) AND language = $2 AND oid <> COALESCE($3, '')`,
                values: [name, language, oid ?? null],
            });
            if (clash) fail(409, `A template called ${name} in that language already exists. Give this one another name.`, { field: "name" });

            if (!oid) {
                const created = { oid: uuidv4(), name, language, body, order_statuses, status };
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.MESSAGE_TEMPLATE} (oid, name, language, body, order_statuses, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    values: [created.oid, name, language, body, order_statuses, status, user_id],
                });
                await saveLogActivity({ reference_type: "message_template", reference_oid: created.oid, title: "Added message template", description: `${name} (${language})` }, { tx, request });
                return created;
            }
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.MESSAGE_TEMPLATE} SET name = $2, language = $3, body = $4, order_statuses = $5, status = $6, edited_by = $7, edited_on = clock_timestamp() WHERE oid = $1 RETURNING oid`,
                values: [oid, name, language, body, order_statuses, status, user_id],
            });
            if (updated.rowCount !== 1) fail(404, "That template was not found. Reload the page.");
            await saveLogActivity({ reference_type: "message_template", reference_oid: oid, title: "Updated message template", description: `${name} (${language}), ${status}` }, { tx, request });
            return { oid, name, language, body, order_statuses, status };
        });
        return res.status(200).json({ code: 200, message: "Message template saved", data: saved });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while saving a message template: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The template was not saved. Try again in a moment." });
    }
};

module.exports = save_message_template;
