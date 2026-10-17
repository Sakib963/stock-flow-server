const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { partner_list_schema, partner_oid_schema, partner_create_schema, partner_update_schema, partner_availability_schema } = require("./schema");
const get_partner_list = require("./controller/get-partner-list");
const get_partner_details = require("./controller/get-partner-details");
const check_partner_availability = require("./controller/check-partner-availability");
const create_partner = require("./controller/create-partner");
const update_partner_details = require("./controller/update-partner-details");

const router = Router();

router.get(ROUTES.GET_PARTNER_LIST, [jwtMiddleware, requirePermission("marketing.partner.view"), validator.get(partner_list_schema)], get_partner_list);
router.get(ROUTES.GET_PARTNER_DETAILS + "/:oid", [jwtMiddleware, requirePermission("marketing.partner.view"), validator.params(partner_oid_schema)], get_partner_details);
router.get(ROUTES.CHECK_PARTNER_AVAILABILITY, [jwtMiddleware, requirePermission("marketing.partner.view"), validator.get(partner_availability_schema)], check_partner_availability);
router.post(ROUTES.CREATE_PARTNER, [jwtMiddleware, requirePermission("marketing.partner.create"), validator.post(partner_create_schema)], create_partner);
router.post(ROUTES.UPDATE_PARTNER_DETAILS, [jwtMiddleware, requirePermission("marketing.partner.edit"), validator.post(partner_update_schema)], update_partner_details);

module.exports = { partnerRouter: router };
