const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const {
  purchase_order_list_schema,
  purchase_order_schema,
  verify_purchase_order_schema,
  purchase_order_details_schema,
} = require("./schema");
const { validator } = require("../../../utils/validator");
const get_purchase_order_list = require("./controller/get-purchase-order-list");
const get_purchase_order_details = require("./controller/get-purchase-order-details");
const create_purchase_order = require("./controller/create-purchase-order");
const update_purchase_order_details = require("./controller/update-purchase-order-details");
const verify_purchase_order = require("./controller/verify-purchase-order");
const cancel_purchase_order = require("./controller/cancel-purchase-order");
const get_purchase_order_report = require("./controller/get-purchase-order-report");
const get_purchase_order_products_report = require("./controller/get-purchase-order-products-report");

const router = Router();

// Get Purchase Order List
router.get(
  ROUTES.GET_PURCHASE_LIST,
  [jwtMiddleware, validator.get(purchase_order_list_schema)],
  get_purchase_order_list,
);

// Get Purchase Order Details
router.get(
  ROUTES.GET_PURCHASE_DETAILS,
  [jwtMiddleware, validator.get(purchase_order_details_schema)],
  get_purchase_order_details,
);

// Get Purchase Order Details by param (configuration-style)
router.get(
  ROUTES.GET_PURCHASE_DETAILS + "/:oid",
  [jwtMiddleware],
  get_purchase_order_details,
);

// Create A New Purchase Order
router.post(
  ROUTES.CREATE_PURCHASE,
  [jwtMiddleware, validator.post(purchase_order_schema)],
  create_purchase_order,
);

// Update Purchase Order
router.post(
  ROUTES.UPDATE_PURCHASE_DETAILS,
  [jwtMiddleware, validator.post(purchase_order_schema)],
  update_purchase_order_details,
);

// Verify Purchase Order
router.post(
  ROUTES.VERIFY_PURCHASE,
  [jwtMiddleware, validator.post(verify_purchase_order_schema)],
  verify_purchase_order,
);

// Cancel Purchase Order
router.get(
  ROUTES.CANCEL_PURCHASE,
  [jwtMiddleware, validator.get(purchase_order_details_schema)],
  cancel_purchase_order,
);

// Purchase Order Summary Report
router.post(
  ROUTES.GET_PURCHASE_ORDER_REPORT,
  [jwtMiddleware, validator.post(purchase_order_details_schema)],
  get_purchase_order_report,
);

// Purchase Order Products Report
router.post(
  ROUTES.GET_PURCHASE_ORDER_PRODUCTS_REPORT,
  [jwtMiddleware, validator.post(purchase_order_details_schema)],
  get_purchase_order_products_report,
);

module.exports = { purchaseOrderRouter: router };
