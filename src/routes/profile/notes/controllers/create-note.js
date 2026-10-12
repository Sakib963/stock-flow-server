const { TABLE } = require("../../../../utils/constant");
const { execute_value, get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// No activity row, unlike every other write: the activity log is read by the owner, and a note is
// the person's own (decided by the user, 2026-10-12).
const create_note = async (request, res) => {
    const { oid, note_title, note_text, tags } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const created = await execute_value({
            text: `INSERT INTO ${TABLE.USER_NOTES} (oid, title, content, tags, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (oid) DO NOTHING`,
            values: [oid, note_title, note_text, tags, user_id],
        });
        // A save repeated after a lost answer finds the note it made; someone else's id is refused.
        if (created.rowCount !== 1) {
            const [mine] = await get_data({ text: `SELECT oid FROM ${TABLE.USER_NOTES} WHERE oid = $1 AND created_by = $2`, values: [oid, user_id] });
            if (!mine) return res.status(409).json({ code: 409, message: "That note could not be saved. Try again." });
        }
        return res.status(200).json({ code: 200, message: "Note saved", data: { oid } });
    } catch (e) {
        log.error(`An exception occurred while saving a note: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The note was not saved. Try again in a moment." });
    }
};

module.exports = create_note;
