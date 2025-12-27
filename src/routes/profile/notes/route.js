const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const get_note_list = require("./controllers/get-notes-list");
const { get_note_by_id_schema, update_note_schema, create_note_schema } = require("./schema");
const get_note_details = require("./controllers/get-note-details");
const create_note = require("./controllers/create-note");
const update_note = require("./controllers/update-note");
const delete_note = require("./controllers/delete-note");

const router = Router();

// Get User note list
router.get(
      ROUTES.GET_USER_NOTE_LIST,
      [jwtMiddleware],
      get_note_list
);

// Get note by id
router.get(
      ROUTES.GET_USER_NOTE_DETAILS,
      [jwtMiddleware, validator.get(get_note_by_id_schema)],
      get_note_details
);

// Create note
router.post(
      ROUTES.CREATE_USER_NOTE,
      [jwtMiddleware, validator.post(create_note_schema)],
      create_note
);

// Update note
router.post(
      ROUTES.UPDATE_USER_NOTE,
      [jwtMiddleware, validator.post(update_note_schema)],
      update_note
);

// Delete note
router.delete(
      ROUTES.DELETE_USER_NOTE,
      [jwtMiddleware],
      delete_note
);


module.exports = { profileNotesRouter: router };