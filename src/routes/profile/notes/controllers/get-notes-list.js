const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// The caller's own notes, the one touched last first. A person keeps tens, not thousands, so the
// whole list comes at once and the panel searches it in the browser.
const get_note_list = async (request, res) => {
    try {
        const rows = await get_data({
            text: `SELECT oid, title AS note_title, content AS note_text, tags, created_on, edited_on
                     FROM ${TABLE.USER_NOTES}
                    WHERE created_by = $1
                    ORDER BY COALESCE(edited_on, created_on) DESC, oid`,
            values: [request.credentials.user_id],
        });
        return res.status(200).json({ code: 200, message: "Notes", data: rows });
    } catch (e) {
        log.error(`An exception occurred while listing notes: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load your notes. Try again in a moment." });
    }
};

module.exports = get_note_list;
