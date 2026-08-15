const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const { pos_product_list_schema, pos_checkout_schema, pos_draft_schema } = require("./schema");
const get_product_list = require("./controller/get-product-list");
const get_invoice_number = require("./controller/get-invoice-number");
const checkout_pos_sale = require("./controller/checkout-pos-sale");
const save_pos_draft = require("./controller/save-draft");

const router = Router();

router.get(ROUTES.GET_POS_PRODUCT_LIST, [jwtMiddleware, validator.get(pos_product_list_schema)], get_product_list);
router.get(ROUTES.GET_ORDER_INVOICE_NUMBER, [jwtMiddleware], get_invoice_number);
router.post(ROUTES.CHECKOUT_POS_SALE, [jwtMiddleware, validator.post(pos_checkout_schema)], checkout_pos_sale);
router.post(ROUTES.SAVE_POS_DRAFT, [jwtMiddleware, validator.post(pos_draft_schema)], save_pos_draft);

module.exports = { posRouter: router };
