const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { online_order_setup_schema, chat_message_schema, create_online_order_schema, online_draft_schema, online_drafts_schema, online_draft_oid_schema } = require("./schema");
const get_online_order_setup = require("./controller/get-online-order-setup");
const read_chat_message = require("./controller/read-chat-message");
const create_online_order = require("./controller/create-online-order");
const save_online_draft = require("./controller/save-online-draft");
const get_online_drafts = require("./controller/get-online-drafts");
const discard_online_draft = require("./controller/discard-online-draft");

const router = Router();

router.get(ROUTES.GET_ONLINE_ORDER_SETUP, [jwtMiddleware, requirePermission("sales.online.view"), validator.get(online_order_setup_schema)], get_online_order_setup);

// A POST although it writes nothing: the text is a customer's message, which does not belong in a URL.
router.post(ROUTES.READ_CHAT_MESSAGE, [jwtMiddleware, requirePermission("sales.online.create"), validator.post(chat_message_schema)], read_chat_message);

router.post(ROUTES.CREATE_ONLINE_ORDER, [jwtMiddleware, requirePermission("sales.online.create"), validator.post(create_online_order_schema)], create_online_order);

router.post(ROUTES.SAVE_ONLINE_DRAFT, [jwtMiddleware, requirePermission("sales.online.create"), validator.post(online_draft_schema)], save_online_draft);

router.get(ROUTES.GET_ONLINE_DRAFTS, [jwtMiddleware, requirePermission("sales.online.create"), validator.get(online_drafts_schema)], get_online_drafts);

router.post(ROUTES.DISCARD_ONLINE_DRAFT, [jwtMiddleware, requirePermission("sales.online.create"), validator.post(online_draft_oid_schema)], discard_online_draft);

module.exports = { onlineRouter: router };
