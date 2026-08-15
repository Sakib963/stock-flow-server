const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const { smart_fill_schema, create_online_order_schema, online_draft_schema, create_preorder_schema, convert_preorder_schema } = require("./schema");
const smart_fill = require("./controller/smart-fill");
const create_online_order = require("./controller/create-online-order");
const save_online_draft = require("./controller/save-draft");
const create_preorder = require("./controller/create-preorder");
const convert_preorder = require("./controller/convert-preorder");
const get_preorders_for_product = require("./controller/get-preorders-for-product");

const router = Router();

router.post(ROUTES.SMART_FILL, [jwtMiddleware, validator.post(smart_fill_schema)], smart_fill);
router.post(ROUTES.CREATE_ONLINE_ORDER, [jwtMiddleware, validator.post(create_online_order_schema)], create_online_order);
router.post(ROUTES.SAVE_ONLINE_DRAFT, [jwtMiddleware, validator.post(online_draft_schema)], save_online_draft);
router.post(ROUTES.CREATE_PREORDER, [jwtMiddleware, validator.post(create_preorder_schema)], create_preorder);
router.post(ROUTES.CONVERT_PREORDER, [jwtMiddleware, validator.post(convert_preorder_schema)], convert_preorder);
router.get(ROUTES.GET_PREORDERS_FOR_PRODUCT, [jwtMiddleware], get_preorders_for_product);

module.exports = { onlineRouter: router };
