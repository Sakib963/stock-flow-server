const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const requirePermission = require("../../../middleware/require-permission");
const { giveaway_list_schema, giveaway_oid_schema, create_giveaway_schema, cancel_giveaway_schema } = require("./schema");
const get_giveaway_list = require("./controller/get-giveaway-list");
const get_giveaway_details = require("./controller/get-giveaway-details");
const create_giveaway = require("./controller/create-giveaway");
const give_giveaway = require("./controller/give-giveaway");
const cancel_giveaway = require("./controller/cancel-giveaway");

const router = Router();

router.get(ROUTES.GET_GIVEAWAY_LIST, [jwtMiddleware, requirePermission("sales.giveaway.view"), validator.get(giveaway_list_schema)], get_giveaway_list);
router.get(ROUTES.GET_GIVEAWAY_DETAILS + "/:oid", [jwtMiddleware, requirePermission("sales.giveaway.view"), validator.params(giveaway_oid_schema)], get_giveaway_details);
router.post(ROUTES.CREATE_GIVEAWAY, [jwtMiddleware, requirePermission("sales.giveaway.create"), validator.post(create_giveaway_schema)], create_giveaway);
router.post(ROUTES.GIVE_GIVEAWAY, [jwtMiddleware, requirePermission("sales.giveaway.confirm"), validator.post(giveaway_oid_schema)], give_giveaway);
router.post(ROUTES.CANCEL_GIVEAWAY, [jwtMiddleware, requirePermission("sales.giveaway.cancel"), validator.post(cancel_giveaway_schema)], cancel_giveaway);

module.exports = { giveawayRouter: router };
