const { Router } = require("express");

const { SUB_CONTEXTS } = require("../../utils/constant");
const { changePasswordRouter } = require("./change-password/route");
const { profileInfoRouter } = require("./profile-info/route");

const router = Router();

router.use(SUB_CONTEXTS.CHANGE_PASSWORD, changePasswordRouter);
router.use(SUB_CONTEXTS.PROFILE_INFO, profileInfoRouter);


module.exports = { profileRouter: router };
