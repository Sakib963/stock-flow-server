const { Router } = require("express");

const { SUB_CONTEXTS } = require("../../utils/constant");
const { changePasswordRouter } = require("./change-password/route");
const { profileInfoRouter } = require("./profile-info/route");
const { profileNotesRouter } = require("./notes/route");

const router = Router();

router.use(SUB_CONTEXTS.CHANGE_PASSWORD, changePasswordRouter);
router.use(SUB_CONTEXTS.PROFILE_INFO, profileInfoRouter);
router.use(SUB_CONTEXTS.NOTES, profileNotesRouter);


module.exports = { profileRouter: router };
