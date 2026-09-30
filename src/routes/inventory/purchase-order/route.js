const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const {
      purchase_order_list_schema,
      purchase_order_oid_schema,
      purchase_order_create_schema,
      purchase_order_update_schema,
      purchase_order_payment_schema,
      purchase_order_cancel_schema,
      purchase_order_verify_schema,
      batch_expiry_schema,
      purchase_product_picker_schema,
} = require("./schema");
const get_purchase_order_list = require("./controller/get-purchase-order-list");
const get_purchase_order_details = require("./controller/get-purchase-order-details");
const get_product_list_for_purchase = require("./controller/get-product-list-for-purchase");
const create_purchase_order = require("./controller/create-purchase-order");
const update_purchase_order_details = require("./controller/update-purchase-order-details");
const update_purchase_payment = require("./controller/update-purchase-payment");
const verify_purchase_order = require("./controller/verify-purchase-order");
const update_batch_expiry = require("./controller/update-batch-expiry");
const cancel_purchase_order = require("./controller/cancel-purchase-order");
const get_purchase_order_report = require("./controller/get-purchase-order-report");
const get_purchase_order_products_report = require("./controller/get-purchase-order-products-report");

const router = Router();

router.get(ROUTES.GET_PURCHASE_LIST, [jwtMiddleware, requirePermission("inventory.purchase-order.view"), validator.get(purchase_order_list_schema)], get_purchase_order_list);

router.get(ROUTES.GET_PURCHASE_DETAILS + "/:oid", [jwtMiddleware, requirePermission("inventory.purchase-order.view"), validator.params(purchase_order_oid_schema)], get_purchase_order_details);

router.get(
      ROUTES.GET_PRODUCT_LIST_FOR_PURCHASE,
      [jwtMiddleware, requirePermission(["inventory.purchase-order.create", "inventory.purchase-order.edit"]), validator.get(purchase_product_picker_schema)],
      get_product_list_for_purchase
);

router.post(ROUTES.CREATE_PURCHASE, [jwtMiddleware, requirePermission("inventory.purchase-order.create"), validator.post(purchase_order_create_schema)], create_purchase_order);

router.post(ROUTES.UPDATE_PURCHASE_DETAILS, [jwtMiddleware, requirePermission("inventory.purchase-order.edit"), validator.post(purchase_order_update_schema)], update_purchase_order_details);

router.post(ROUTES.UPDATE_PURCHASE_PAYMENT, [jwtMiddleware, requirePermission("inventory.purchase-order.edit"), validator.post(purchase_order_payment_schema)], update_purchase_payment);

router.post(ROUTES.VERIFY_PURCHASE, [jwtMiddleware, requirePermission("inventory.purchase-order.approve"), validator.post(purchase_order_verify_schema)], verify_purchase_order);

router.post(ROUTES.UPDATE_BATCH_EXPIRY, [jwtMiddleware, requirePermission(["inventory.purchase-order.edit", "inventory.overview.edit"]), validator.post(batch_expiry_schema)], update_batch_expiry);

router.post(ROUTES.CANCEL_PURCHASE, [jwtMiddleware, requirePermission("inventory.purchase-order.cancel"), validator.post(purchase_order_cancel_schema)], cancel_purchase_order);

router.post(ROUTES.GET_PURCHASE_ORDER_REPORT, [jwtMiddleware, requirePermission("inventory.purchase-order.export"), validator.post(purchase_order_oid_schema)], get_purchase_order_report);

router.post(ROUTES.GET_PURCHASE_ORDER_PRODUCTS_REPORT, [jwtMiddleware, requirePermission("inventory.purchase-order.export"), validator.post(purchase_order_oid_schema)], get_purchase_order_products_report);

module.exports = { purchaseOrderRouter: router };
