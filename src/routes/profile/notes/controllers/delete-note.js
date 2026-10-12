const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const delete_note = async (request, res) => {
    const { oid } = request.body;
    try {
        const deleted = await execute_value({ text: `DELETE FROM ${TABLE.USER_NOTES} WHERE oid = $1 AND created_by = $2`, values: [oid, request.credentials.user_id] });
        if (deleted.rowCount !== 1) return res.status(404).json({ code: 404, message: "That note no longer exists." });
        return res.status(200).json({ code: 200, message: "Note deleted", data: { oid } });
    } catch (e) {
        log.error(`An exception occurred while deleting a note: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The note was not deleted. Try again in a moment." });
    }
};

module.exports = delete_note;
