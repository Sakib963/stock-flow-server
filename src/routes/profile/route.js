const { Router } = require("express");

const { SUB_CONTEXTS } = require("../../utils/constant");
const { changePasswordRouter } = require("./change-password/route");

const router = Router();

router.use(SUB_CONTEXTS.CHANGE_PASSWORD, changePasswordRouter);


module.exports = { profileRouter: router };
