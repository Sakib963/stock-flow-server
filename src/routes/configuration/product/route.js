const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { product_list_schema, product_dropdown_schema, product_oid_schema, product_create_schema, product_update_schema, product_availability_schema, product_sku_generate_schema, product_photo_sign_schema, product_details_schema } = require("./schema");
const { validator } = require("../../../middleware/validator");
const get_product_list = require("./controller/get-product-list");
const get_product_list_for_dropdown = require("./controller/get-product-list-for-dropdown");
const create_product = require("./controller/create-product");
const update_product_details = require("./controller/update-product-details");
const get_product_details = require("./controller/get-product-details");
const delete_product = require("./controller/delete-product");
const check_product_availability = require("./controller/check-product-availability");
const generate_product_sku = require("./controller/generate-product-sku");
const sign_product_photo_upload = require("./controller/sign-product-photo-upload");
const generate_product_inventory_report = require("./controller/generate-product-inventory-report");
const generate_product_movement_report = require("./controller/generate-product-movement-report");

const router = Router();

router.get(ROUTES.GET_PRODUCT_LIST, [jwtMiddleware, requirePermission("configuration.product.view"), validator.get(product_list_schema)], get_product_list);

router.get(ROUTES.GET_PRODUCT_LIST_FOR_DROPDOWN, [jwtMiddleware, requirePermission("configuration.product.view"), validator.get(product_dropdown_schema)], get_product_list_for_dropdown);

router.get(ROUTES.CHECK_PRODUCT_AVAILABILITY, [jwtMiddleware, requirePermission("configuration.product.view"), validator.get(product_availability_schema)], check_product_availability);

router.get(ROUTES.GENERATE_PRODUCT_SKU, [jwtMiddleware, requirePermission("configuration.product.view"), validator.get(product_sku_generate_schema)], generate_product_sku);

router.post(ROUTES.SIGN_PRODUCT_PHOTO_UPLOAD, [jwtMiddleware, requirePermission(["configuration.product.create", "configuration.product.edit"]), validator.post(product_photo_sign_schema)], sign_product_photo_upload);

router.post(ROUTES.CREATE_PRODUCT, [jwtMiddleware, requirePermission("configuration.product.create"), validator.post(product_create_schema)], create_product);

router.post(ROUTES.UPDATE_PRODUCT_DETAILS, [jwtMiddleware, requirePermission("configuration.product.edit"), validator.post(product_update_schema)], update_product_details);

router.get(ROUTES.GET_PRODUCT_DETAILS + "/:oid", [jwtMiddleware, requirePermission("configuration.product.view"), validator.params(product_oid_schema)], get_product_details);

router.post(ROUTES.DELETE_PRODUCT, [jwtMiddleware, requirePermission("configuration.product.delete"), validator.post(product_details_schema)], delete_product);

router.post(ROUTES.GENERATE_PRODUCT_INVENTORY_REPORT, [jwtMiddleware, requirePermission("configuration.product.export"), validator.post(product_details_schema)], generate_product_inventory_report);

router.post(ROUTES.GENERATE_PRODUCT_MOVEMENT_REPORT, [jwtMiddleware, requirePermission("configuration.product.export"), validator.post(product_details_schema)], generate_product_movement_report);

module.exports = { productRouter: router };
