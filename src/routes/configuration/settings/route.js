const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const { update_settings_schema } = require("./schema");
const get_settings = require("./controller/get-settings");
const update_settings = require("./controller/update-settings");

const router = Router();

router.get(ROUTES.GET_SETTINGS, [jwtMiddleware], get_settings);
router.post(ROUTES.UPDATE_SETTINGS, [jwtMiddleware, validator.post(update_settings_schema)], update_settings);

module.exports = { settingsRouter: router };
