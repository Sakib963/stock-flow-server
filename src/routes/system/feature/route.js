const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { feature_list_schema, feature_oid_schema, feature_update_schema, feature_switch_schema } = require("./schema");
const get_feature_list = require("./controller/get-feature-list");
const get_feature_details = require("./controller/get-feature-details");
const update_feature_details = require("./controller/update-feature-details");
const switch_feature = require("./controller/switch-feature");

const router = Router();

router.get(ROUTES.GET_FEATURE_LIST, [jwtMiddleware, requirePermission("system.feature.view"), validator.get(feature_list_schema)], get_feature_list);
router.get(ROUTES.GET_FEATURE_DETAILS + "/:oid", [jwtMiddleware, requirePermission("system.feature.view"), validator.params(feature_oid_schema)], get_feature_details);
router.post(ROUTES.UPDATE_FEATURE_DETAILS, [jwtMiddleware, requirePermission("system.feature.edit"), validator.post(feature_update_schema)], update_feature_details);
router.post(ROUTES.SWITCH_FEATURE, [jwtMiddleware, requirePermission("system.feature.edit"), validator.post(feature_switch_schema)], switch_feature);

module.exports = { featureRouter: router };
