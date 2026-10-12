const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { update_settings_schema, get_settings_schema, sign_logo_schema } = require("./schema");
const get_settings = require("./controller/get-settings");
const update_settings = require("./controller/update-settings");
const sign_settings_logo_upload = require("./controller/sign-settings-logo-upload");

const router = Router();

router.get(ROUTES.GET_SETTINGS, [jwtMiddleware, requirePermission("settings.business.view"), validator.get(get_settings_schema)], get_settings);
router.post(ROUTES.UPDATE_SETTINGS, [jwtMiddleware, requirePermission("settings.business.edit"), validator.post(update_settings_schema)], update_settings);
router.post(ROUTES.SIGN_SETTINGS_LOGO_UPLOAD, [jwtMiddleware, requirePermission("settings.business.edit"), validator.post(sign_logo_schema)], sign_settings_logo_upload);

module.exports = { settingsRouter: router };
