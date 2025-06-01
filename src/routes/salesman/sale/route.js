const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { product_list_schema, sales_schema, invoice_details_schema } = require("./schema");
const get_product_list = require("./controller/get-product-list");
const get_invoice_number = require("./controller/get-invoice-number");
const get_sale_details = require("./controller/get-sale-details");
const save_invoice_in_draft = require("./controller/save-invoice-in-draft");
const confirm_sales_invoice = require("./controller/confirm-sales-invoice");

const router = Router();

// Get Product List
router.get(
      ROUTES.GET_PRODUCT_LIST,
      [jwtMiddleware, validator.get(product_list_schema)],
      get_product_list
);

// Get Invoice Number
router.get(
      ROUTES.GET_INVOICE_NUMBER,
      [jwtMiddleware],
      get_invoice_number
);

// Get Invoice Details
router.get(
      ROUTES.GET_INVOICE_DETAILS,
      [jwtMiddleware, validator.get(invoice_details_schema)],
      get_sale_details
);

// SAVE INVOICE IN DRAFT
router.post(
      ROUTES.SAVE_INVOICE_IN_DRAFT,
      [jwtMiddleware, validator.post(sales_schema)],
      save_invoice_in_draft
);

// Confirm Invoice
router.post(
      ROUTES.CONFIRM_SALES_INVOICE,
      [jwtMiddleware, validator.post(sales_schema)],
      confirm_sales_invoice
);

module.exports = { saleRouter: router };