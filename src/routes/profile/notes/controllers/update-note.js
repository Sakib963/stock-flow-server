const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const update_note = async (request, res) => {
    const { oid, note_title, note_text, tags } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const updated = await execute_value({
            text: `UPDATE ${TABLE.USER_NOTES} SET title = $1, content = $2, tags = $5, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $4 AND created_by = $3`,
            values: [note_title, note_text, user_id, oid, tags],
        });
        if (updated.rowCount !== 1) return res.status(404).json({ code: 404, message: "That note no longer exists. It may have been deleted in another tab." });
        return res.status(200).json({ code: 200, message: "Note saved", data: { oid } });
    } catch (e) {
        log.error(`An exception occurred while updating a note: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The note was not saved. Try again in a moment." });
    }
};

module.exports = update_note;
