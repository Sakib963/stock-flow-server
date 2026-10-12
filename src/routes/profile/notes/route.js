const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const { note_list_schema, create_note_schema, update_note_schema, note_oid_schema } = require("./schema");
const get_note_list = require("./controllers/get-notes-list");
const create_note = require("./controllers/create-note");
const update_note = require("./controllers/update-note");
const delete_note = require("./controllers/delete-note");

// A person's own notes, with no permission on purpose (decided by the user, 2026-10-12): every
// signed-in person has them, as with signing out everywhere, and every query is held to the
// caller's own rows by created_by, so no one else's note can be reached through them.
const router = Router();

router.get(ROUTES.GET_USER_NOTE_LIST, [jwtMiddleware, validator.get(note_list_schema)], get_note_list);
router.post(ROUTES.CREATE_USER_NOTE, [jwtMiddleware, validator.post(create_note_schema)], create_note);
router.post(ROUTES.UPDATE_USER_NOTE, [jwtMiddleware, validator.post(update_note_schema)], update_note);
router.post(ROUTES.DELETE_USER_NOTE, [jwtMiddleware, validator.post(note_oid_schema)], delete_note);

module.exports = { profileNotesRouter: router };
