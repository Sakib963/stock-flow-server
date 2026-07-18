const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const {
  product_dispose_list_schema,
  product_dispose_schema,
  product_dispose_details_schema,
} = require("./schema");
const get_product_dispose_list = require("./controller/get-product-dispose-list");
const get_product_dispose_details = require("./controller/get-product-dispose-details");
const create_product_dispose = require("./controller/create-product-dispose");
const update_product_dispose_details = require("./controller/update-product-dispose-details");
const approve_product_dispose = require("./controller/approve-product-dispose");
const reject_product_dispose = require("./controller/reject-product-dispose");
const cancel_product_dispose = require("./controller/cancel-product-dispose");
const reverse_product_dispose = require("./controller/reverse-product-dispose");
const get_product_list_for_dispose_dropdown = require("./controller/get-product-list-for-dispose-dropdown");

const router = Router();

// Get Product Dispose List
router.get(
  ROUTES.GET_PRODUCT_DISPOSE_LIST,
  [jwtMiddleware, validator.get(product_dispose_list_schema)],
  get_product_dispose_list,
);

// Get in-stock batches for the dispose form dropdown
router.get(
  ROUTES.GET_PRODUCT_LIST_FOR_DISPOSE_DROPDOWN,
  [jwtMiddleware],
  get_product_list_for_dispose_dropdown,
);

// Get Product Dispose Details (by param)
router.get(
  ROUTES.GET_PRODUCT_DISPOSE_DETAILS + "/:oid",
  [jwtMiddleware],
  get_product_dispose_details,
);

// Create A New Product Dispose
router.post(
  ROUTES.CREATE_PRODUCT_DISPOSE,
  [jwtMiddleware, validator.post(product_dispose_schema)],
  create_product_dispose,
);

// Update Product Dispose (only while Submitted)
router.post(
  ROUTES.UPDATE_PRODUCT_DISPOSE_DETAILS,
  [jwtMiddleware, validator.post(product_dispose_schema)],
  update_product_dispose_details,
);

// Approve Product Dispose (deducts stock)
router.post(
  ROUTES.APPROVE_PRODUCT_DISPOSE,
  [jwtMiddleware, validator.post(product_dispose_details_schema)],
  approve_product_dispose,
);

// Reject Product Dispose
router.post(
  ROUTES.REJECT_PRODUCT_DISPOSE,
  [jwtMiddleware, validator.post(product_dispose_details_schema)],
  reject_product_dispose,
);

// Cancel Product Dispose
router.post(
  ROUTES.CANCEL_PRODUCT_DISPOSE,
  [jwtMiddleware, validator.post(product_dispose_details_schema)],
  cancel_product_dispose,
);

// Reverse Product Dispose (restores stock)
router.post(
  ROUTES.REVERSE_PRODUCT_DISPOSE,
  [jwtMiddleware, validator.post(product_dispose_details_schema)],
  reverse_product_dispose,
);

module.exports = { productDisposeRouter: router };
