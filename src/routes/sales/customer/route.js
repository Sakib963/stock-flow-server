const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { customer_list_schema, customer_oid_schema, customer_phone_schema, customer_create_schema, customer_update_schema, customer_flag_schema, address_create_schema, address_update_schema, address_oid_schema } = require("./schema");
const get_customer_list = require("./controller/get-customer-list");
const get_customer_details = require("./controller/get-customer-details");
const find_customer_by_phone = require("./controller/find-customer-by-phone");
const create_customer = require("./controller/create-customer");
const update_customer_details = require("./controller/update-customer-details");
const flag_customer = require("./controller/flag-customer");
const create_customer_address = require("./controller/create-customer-address");
const update_customer_address = require("./controller/update-customer-address");
const retire_customer_address = require("./controller/retire-customer-address");
const generate_customer_list_report = require("./controller/generate-customer-list-report");

const router = Router();

router.get(ROUTES.GET_CUSTOMER_LIST, [jwtMiddleware, requirePermission("sales.customer.view"), validator.get(customer_list_schema)], get_customer_list);

router.get(ROUTES.GET_CUSTOMER_DETAILS + "/:oid", [jwtMiddleware, requirePermission("sales.customer.view"), validator.params(customer_oid_schema)], get_customer_details);

// Phone first on the POS and online order pages as well as the customers screens, so selling at
// either counter opens it. A POST so the phone stays out of URLs; the request log keeps it, as it
// keeps every customer write.
router.post(ROUTES.FIND_CUSTOMER_BY_PHONE, [jwtMiddleware, requirePermission(["sales.customer.view", "sales.pos.create", "sales.online.create"]), validator.post(customer_phone_schema)], find_customer_by_phone);

router.post(ROUTES.CREATE_CUSTOMER, [jwtMiddleware, requirePermission("sales.customer.create"), validator.post(customer_create_schema)], create_customer);

router.post(ROUTES.UPDATE_CUSTOMER_DETAILS, [jwtMiddleware, requirePermission("sales.customer.edit"), validator.post(customer_update_schema)], update_customer_details);

router.post(ROUTES.FLAG_CUSTOMER, [jwtMiddleware, requirePermission("sales.customer.edit"), validator.post(customer_flag_schema)], flag_customer);

router.post(ROUTES.CREATE_CUSTOMER_ADDRESS, [jwtMiddleware, requirePermission("sales.customer.create"), validator.post(address_create_schema)], create_customer_address);

router.post(ROUTES.UPDATE_CUSTOMER_ADDRESS, [jwtMiddleware, requirePermission("sales.customer.edit"), validator.post(address_update_schema)], update_customer_address);

router.post(ROUTES.RETIRE_CUSTOMER_ADDRESS, [jwtMiddleware, requirePermission("sales.customer.edit"), validator.post(address_oid_schema)], retire_customer_address);

router.get(ROUTES.GENERATE_CUSTOMER_LIST_REPORT, [jwtMiddleware, requirePermission("sales.customer.export"), validator.get(customer_list_schema)], generate_customer_list_report);

module.exports = { customerRouter: router };
