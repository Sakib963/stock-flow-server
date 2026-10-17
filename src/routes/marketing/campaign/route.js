const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { campaign_list_schema, campaign_oid_schema, partners_for_campaign_schema, batches_for_campaign_schema, create_campaign_schema, update_campaign_schema, cancel_campaign_schema, create_deliverable_schema, update_deliverable_schema, deliverable_oid_schema } = require("./schema");
const get_campaign_list = require("./controller/get-campaign-list");
const get_campaign_details = require("./controller/get-campaign-details");
const get_partners_for_campaign = require("./controller/get-partners-for-campaign");
const get_batches_for_campaign = require("./controller/get-batches-for-campaign");
const create_campaign = require("./controller/create-campaign");
const update_campaign = require("./controller/update-campaign");
const start_campaign = require("./controller/start-campaign");
const complete_campaign = require("./controller/complete-campaign");
const cancel_campaign = require("./controller/cancel-campaign");
const create_campaign_deliverable = require("./controller/create-campaign-deliverable");
const update_campaign_deliverable = require("./controller/update-campaign-deliverable");
const delete_campaign_deliverable = require("./controller/delete-campaign-deliverable");

const router = Router();
// The form's pickers, read by whoever may plan or change a campaign.
const PLANNERS = ["marketing.campaign.create", "marketing.campaign.edit"];

router.get(ROUTES.GET_CAMPAIGN_LIST, [jwtMiddleware, requirePermission("marketing.campaign.view"), validator.get(campaign_list_schema)], get_campaign_list);
router.get(ROUTES.GET_CAMPAIGN_DETAILS + "/:oid", [jwtMiddleware, requirePermission("marketing.campaign.view"), validator.params(campaign_oid_schema)], get_campaign_details);
router.get(ROUTES.GET_PARTNERS_FOR_CAMPAIGN, [jwtMiddleware, requirePermission(PLANNERS), validator.get(partners_for_campaign_schema)], get_partners_for_campaign);
router.get(ROUTES.GET_BATCHES_FOR_CAMPAIGN, [jwtMiddleware, requirePermission(PLANNERS), validator.get(batches_for_campaign_schema)], get_batches_for_campaign);
router.post(ROUTES.CREATE_CAMPAIGN, [jwtMiddleware, requirePermission("marketing.campaign.create"), validator.post(create_campaign_schema)], create_campaign);
router.post(ROUTES.UPDATE_CAMPAIGN, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(update_campaign_schema)], update_campaign);
router.post(ROUTES.START_CAMPAIGN, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(campaign_oid_schema)], start_campaign);
router.post(ROUTES.COMPLETE_CAMPAIGN, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(campaign_oid_schema)], complete_campaign);
router.post(ROUTES.CANCEL_CAMPAIGN, [jwtMiddleware, requirePermission("marketing.campaign.cancel"), validator.post(cancel_campaign_schema)], cancel_campaign);
// Promised posts are part of running the campaign, so they take its edit permission.
router.post(ROUTES.CREATE_CAMPAIGN_DELIVERABLE, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(create_deliverable_schema)], create_campaign_deliverable);
router.post(ROUTES.UPDATE_CAMPAIGN_DELIVERABLE, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(update_deliverable_schema)], update_campaign_deliverable);
router.post(ROUTES.DELETE_CAMPAIGN_DELIVERABLE, [jwtMiddleware, requirePermission("marketing.campaign.edit"), validator.post(deliverable_oid_schema)], delete_campaign_deliverable);

module.exports = { campaignRouter: router };
