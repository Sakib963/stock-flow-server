const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { pos_product_list_schema, pos_checkout_schema, pos_park_schema, parked_cart_list_schema, parked_cart_oid_schema } = require("./schema");
const get_product_list = require("./controller/get-product-list");
const checkout_pos_sale = require("./controller/checkout-pos-sale");
const park_pos_cart = require("./controller/park-pos-cart");
const get_parked_carts = require("./controller/get-parked-carts");
const discard_parked_cart = require("./controller/discard-parked-cart");

const router = Router();

// The product picker both counters share: the online order adds products as the counter does (sales REQ-37).
router.get(ROUTES.GET_POS_PRODUCT_LIST, [jwtMiddleware, requirePermission(["sales.pos.view", "sales.online.view"]), validator.get(pos_product_list_schema)], get_product_list);

router.post(ROUTES.CHECKOUT_POS_SALE, [jwtMiddleware, requirePermission("sales.pos.create"), validator.post(pos_checkout_schema)], checkout_pos_sale);

router.post(ROUTES.PARK_POS_CART, [jwtMiddleware, requirePermission("sales.pos.create"), validator.post(pos_park_schema)], park_pos_cart);

router.get(ROUTES.GET_PARKED_CARTS, [jwtMiddleware, requirePermission("sales.pos.create"), validator.get(parked_cart_list_schema)], get_parked_carts);

router.post(ROUTES.DISCARD_PARKED_CART, [jwtMiddleware, requirePermission("sales.pos.create"), validator.post(parked_cart_oid_schema)], discard_parked_cart);

module.exports = { posRouter: router };
