const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { user_list_schema, user_oid_schema, empty_schema, check_user_taken_schema, create_user_schema, update_user_schema, switch_user_status_schema } = require("./schema");
const get_user_list = require("./controller/get-user-list");
const get_user_details = require("./controller/get-user-details");
const get_assignable_roles = require("./controller/get-assignable-roles");
const check_user_taken = require("./controller/check-user-taken");
const create_user = require("./controller/create-user");
const update_user = require("./controller/update-user");
const switch_user_status = require("./controller/switch-user-status");
const delete_user = require("./controller/delete-user");
const sign_out_user_everywhere = require("./controller/sign-out-user-everywhere");

const router = Router();

router.get(ROUTES.GET_USER_LIST, [jwtMiddleware, requirePermission("administration.user.view"), validator.get(user_list_schema)], get_user_list);
router.get(ROUTES.GET_USER_DETAILS + "/:oid", [jwtMiddleware, requirePermission("administration.user.view"), validator.params(user_oid_schema)], get_user_details);
router.get(ROUTES.GET_ASSIGNABLE_ROLES, [jwtMiddleware, requirePermission("administration.user.view"), validator.get(empty_schema)], get_assignable_roles);
router.get(ROUTES.CHECK_USER_TAKEN, [jwtMiddleware, requirePermission("administration.user.view"), validator.get(check_user_taken_schema)], check_user_taken);
router.post(ROUTES.CREATE_USER, [jwtMiddleware, requirePermission("administration.user.create"), validator.post(create_user_schema)], create_user);
router.post(ROUTES.UPDATE_USER, [jwtMiddleware, requirePermission("administration.user.edit"), validator.post(update_user_schema)], update_user);
router.post(ROUTES.SWITCH_USER_STATUS, [jwtMiddleware, requirePermission("administration.user.edit"), validator.post(switch_user_status_schema)], switch_user_status);
router.post(ROUTES.SIGN_OUT_USER_EVERYWHERE, [jwtMiddleware, requirePermission("administration.user.edit"), validator.post(user_oid_schema)], sign_out_user_everywhere);
router.post(ROUTES.DELETE_USER, [jwtMiddleware, requirePermission("administration.user.delete"), validator.post(user_oid_schema)], delete_user);

module.exports = { userRouter: router };
