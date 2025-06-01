const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { invoice_list_schema, delete_invoice_schema } = require("./schema");
const get_invoice_list = require("./controller/get-invoice-list");
const delete_invoice = require("./controller/delete-invoice");

const router = Router();

// Get Invoice List
router.get(
      ROUTES.GET_INVOICE_LIST,
      [jwtMiddleware, validator.get(invoice_list_schema)],
      get_invoice_list
);

// Delete Invoice
router.post(
      ROUTES.DELETE_INVOICE,
      [jwtMiddleware, validator.post(delete_invoice_schema)],
      delete_invoice
);

module.exports = { invoiceRouter: router };