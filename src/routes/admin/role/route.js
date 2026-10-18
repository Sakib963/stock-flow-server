const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { role_list_schema, role_tree_schema, role_oid_schema, create_role_schema, update_role_schema, switch_role_status_schema } = require("./schema");
const get_role_list = require("./controller/get-role-list");
const get_role_tree = require("./controller/get-role-tree");
const get_role_details = require("./controller/get-role-details");
const create_role = require("./controller/create-role");
const update_role = require("./controller/update-role");
const switch_role_status = require("./controller/switch-role-status");
const delete_role = require("./controller/delete-role");

const router = Router();

router.get(ROUTES.GET_ROLE_LIST, [jwtMiddleware, requirePermission("administration.role.view"), validator.get(role_list_schema)], get_role_list);
router.get(ROUTES.GET_ROLE_TREE, [jwtMiddleware, requirePermission("administration.role.view"), validator.get(role_tree_schema)], get_role_tree);
router.get(ROUTES.GET_ROLE_DETAILS + "/:oid", [jwtMiddleware, requirePermission("administration.role.view"), validator.params(role_oid_schema)], get_role_details);
router.post(ROUTES.CREATE_ROLE, [jwtMiddleware, requirePermission("administration.role.create"), validator.post(create_role_schema)], create_role);
router.post(ROUTES.UPDATE_ROLE, [jwtMiddleware, requirePermission("administration.role.edit"), validator.post(update_role_schema)], update_role);
router.post(ROUTES.SWITCH_ROLE_STATUS, [jwtMiddleware, requirePermission("administration.role.edit"), validator.post(switch_role_status_schema)], switch_role_status);
router.post(ROUTES.DELETE_ROLE, [jwtMiddleware, requirePermission("administration.role.delete"), validator.post(role_oid_schema)], delete_role);

module.exports = { roleRouter: router };
