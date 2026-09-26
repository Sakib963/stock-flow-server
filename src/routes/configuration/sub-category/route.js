const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { sub_category_list_schema, sub_category_dropdown_schema, sub_category_oid_schema, sub_category_create_schema, sub_category_update_schema, sub_category_availability_schema, sub_category_code_generate_schema, sub_category_details_schema } = require("./schema");
const create_sub_category = require("./controller/create-sub-category");
const get_sub_category_details = require("./controller/get-sub-category-details");
const get_sub_category_list = require("./controller/get-sub-category-list");
const get_sub_category_list_for_dropdown = require("./controller/get-sub-category-list-for-dropdown");
const check_sub_category_availability = require("./controller/check-sub-category-availability");
const generate_sub_category_code = require("./controller/generate-sub-category-code");
const generate_inventory_report_by_sub_category = require("./controller/generate-inventory-report-by-sub-category");
const generate_product_list_report_by_sub_category = require("./controller/generate-product-list-report-by-sub-category");
const update_sub_category_details = require("./controller/update-sub-category-details");

const router = Router();

router.get(ROUTES.GET_SUB_CATEGORY_LIST, [jwtMiddleware, requirePermission("configuration.sub-category.view"), validator.get(sub_category_list_schema)], get_sub_category_list);

router.get(ROUTES.GET_SUB_CATEGORY_LIST_FOR_DROPDOWN, [jwtMiddleware, requirePermission("configuration.sub-category.view"), validator.get(sub_category_dropdown_schema)], get_sub_category_list_for_dropdown);

router.get(ROUTES.CHECK_SUB_CATEGORY_AVAILABILITY, [jwtMiddleware, requirePermission("configuration.sub-category.view"), validator.get(sub_category_availability_schema)], check_sub_category_availability);

router.get(ROUTES.GENERATE_SUB_CATEGORY_CODE, [jwtMiddleware, requirePermission("configuration.sub-category.view"), validator.get(sub_category_code_generate_schema)], generate_sub_category_code);

router.post(ROUTES.CREATE_SUB_CATEGORY, [jwtMiddleware, requirePermission("configuration.sub-category.create"), validator.post(sub_category_create_schema)], create_sub_category);

router.post(ROUTES.UPDATE_SUB_CATEGORY_DETAILS, [jwtMiddleware, requirePermission("configuration.sub-category.edit"), validator.post(sub_category_update_schema)], update_sub_category_details);

router.get(ROUTES.GET_SUB_CATEGORY_DETAILS + "/:oid", [jwtMiddleware, requirePermission("configuration.sub-category.view"), validator.params(sub_category_oid_schema)], get_sub_category_details);

router.post(ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_SUB_CATEGORY, [jwtMiddleware, requirePermission("configuration.sub-category.export"), validator.post(sub_category_details_schema)], generate_product_list_report_by_sub_category);

router.post(ROUTES.GENERATE_INVENTORY_REPORT_BY_SUB_CATEGORY, [jwtMiddleware, requirePermission("configuration.sub-category.export"), validator.post(sub_category_details_schema)], generate_inventory_report_by_sub_category);

module.exports = { subCategoryRouter: router };
