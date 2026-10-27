const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { batch_list_schema, ready_orders_schema, batch_oid_schema, create_batch_schema, batch_orders_schema, update_batch_orders_schema, cancel_batch_schema } = require("./schema");
const { online_sellers } = require("../order/utils/order-state");
const get_delivery_batch_list = require("./controller/get-delivery-batch-list");
const get_delivery_batch_details = require("./controller/get-delivery-batch-details");
const get_orders_ready_to_send = require("./controller/get-orders-ready-to-send");
const create_delivery_batch = require("./controller/create-delivery-batch");
const update_delivery_batch_orders = require("./controller/update-delivery-batch-orders");
const get_delivery_batch_upload_file = require("./controller/get-delivery-batch-upload-file");
const hand_over_delivery_batch = require("./controller/hand-over-delivery-batch");
const deliver_delivery_batch = require("./controller/deliver-delivery-batch");
const cancel_delivery_batch = require("./controller/cancel-delivery-batch");

const router = Router();

// Batches carry online orders only, so every route needs the online channel as well as its permission.
router.get(ROUTES.GET_DELIVERY_BATCH_LIST, [jwtMiddleware, requirePermission("sales.delivery-batch.view"), online_sellers, validator.get(batch_list_schema)], get_delivery_batch_list);
router.get(ROUTES.GET_DELIVERY_BATCH_DETAILS + "/:oid", [jwtMiddleware, requirePermission("sales.delivery-batch.view"), online_sellers, validator.params(batch_oid_schema)], get_delivery_batch_details);
// Read by New batch and by Add orders on an open batch, so either permission opens it.
router.get(ROUTES.GET_ORDERS_READY_TO_SEND, [jwtMiddleware, requirePermission(["sales.delivery-batch.create", "sales.delivery-batch.edit"]), online_sellers, validator.get(ready_orders_schema)], get_orders_ready_to_send);
router.post(ROUTES.CREATE_DELIVERY_BATCH, [jwtMiddleware, requirePermission("sales.delivery-batch.create"), online_sellers, validator.post(create_batch_schema)], create_delivery_batch);
router.post(ROUTES.UPDATE_DELIVERY_BATCH_ORDERS, [jwtMiddleware, requirePermission("sales.delivery-batch.edit"), online_sellers, validator.post(update_batch_orders_schema)], update_delivery_batch_orders);
router.get(ROUTES.GET_DELIVERY_BATCH_UPLOAD_FILE + "/:oid", [jwtMiddleware, requirePermission("sales.delivery-batch.edit"), online_sellers, validator.params(batch_oid_schema)], get_delivery_batch_upload_file);
router.post(ROUTES.HAND_OVER_DELIVERY_BATCH, [jwtMiddleware, requirePermission("sales.delivery-batch.dispatch"), online_sellers, validator.post(batch_oid_schema)], hand_over_delivery_batch);
router.post(ROUTES.DELIVER_DELIVERY_BATCH, [jwtMiddleware, requirePermission("sales.delivery-batch.deliver"), online_sellers, validator.post(batch_orders_schema)], deliver_delivery_batch);
router.post(ROUTES.CANCEL_DELIVERY_BATCH, [jwtMiddleware, requirePermission("sales.delivery-batch.cancel"), online_sellers, validator.post(cancel_batch_schema)], cancel_delivery_batch);

module.exports = { deliveryBatchRouter: router };
