const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { invoice_list_schema } = require("./schema");
const get_invoice_list = require("./controller/get-invoice-list");

const router = Router();

// Get Invoice List
router.get(
      ROUTES.GET_INVOICE_LIST,
      [jwtMiddleware, validator.get(invoice_list_schema)],
      get_invoice_list
);

// Get Invoice Details
/* router.get(
      ROUTES.GET_INVOICE_DETAILS,
      [jwtMiddleware, validator.get(invoice_details_schema)],
      get_invoice_details
); */

module.exports = { invoiceRouter: router };