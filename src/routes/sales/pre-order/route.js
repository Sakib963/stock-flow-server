const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const {
    pre_order_list_schema,
    pre_order_schema,
    pre_order_details_schema,
    confirm_pre_order_schema,
    cancel_pre_order_schema,
    record_advance_schema,
    mark_converted_schema,
    product_list_schema,
    batches_for_product_schema,
} = require("./schema");

const get_pre_order_list = require("./controller/get-pre-order-list");
const get_pre_order_list_kpis = require("./controller/get-pre-order-list-kpis");
const get_pre_order_details = require("./controller/get-pre-order-details");
const create_pre_order = require("./controller/create-pre-order");
const update_pre_order_details = require("./controller/update-pre-order-details");
const confirm_pre_order = require("./controller/confirm-pre-order");
const cancel_pre_order = require("./controller/cancel-pre-order");
const record_advance = require("./controller/record-advance");
const get_pre_order_number = require("./controller/get-pre-order-number");
const get_stock_readiness = require("./controller/get-stock-readiness");
const get_batches_for_product = require("./controller/get-batches-for-product");
const mark_converted = require("./controller/mark-converted");
const get_pre_orders_by_product = require("./controller/get-pre-orders-by-product");
const get_ready_to_convert = require("./controller/get-ready-to-convert");
const get_product_list_for_pre_order = require("./controller/get-product-list-for-pre-order");
const generate_pre_order_report = require("./controller/generate-pre-order-report");
const export_pre_order_data = require("./controller/export-pre-order-data");

const router = Router();

// Pre-Order feature. A booking for stock not yet held: part of the sales process,
// but neither a sale nor an order until it is explicitly converted. Lives on its
// own tables so it can never leak into orders, revenue, stock or delivery.

// --- List & analytics ---
router.get(ROUTES.GET_PRE_ORDER_LIST, [jwtMiddleware, validator.get(pre_order_list_schema)], get_pre_order_list);
router.get(ROUTES.GET_PRE_ORDER_LIST_KPIS, [jwtMiddleware], get_pre_order_list_kpis);
router.get(ROUTES.GET_READY_TO_CONVERT, [jwtMiddleware], get_ready_to_convert);
router.get(ROUTES.GET_PRE_ORDERS_BY_PRODUCT, [jwtMiddleware], get_pre_orders_by_product);

// --- Record ---
router.get(ROUTES.GET_PRE_ORDER_DETAILS + "/:oid", [jwtMiddleware], get_pre_order_details);
router.post(ROUTES.CREATE_PRE_ORDER, [jwtMiddleware, validator.post(pre_order_schema)], create_pre_order);
router.post(ROUTES.UPDATE_PRE_ORDER_DETAILS, [jwtMiddleware, validator.post(pre_order_schema)], update_pre_order_details);

// --- Lifecycle ---
router.post(ROUTES.CONFIRM_PRE_ORDER, [jwtMiddleware, validator.post(confirm_pre_order_schema)], confirm_pre_order);
router.post(ROUTES.CANCEL_PRE_ORDER, [jwtMiddleware, validator.post(cancel_pre_order_schema)], cancel_pre_order);
router.post(ROUTES.RECORD_PRE_ORDER_ADVANCE, [jwtMiddleware, validator.post(record_advance_schema)], record_advance);
router.post(ROUTES.MARK_PRE_ORDER_CONVERTED, [jwtMiddleware, validator.post(mark_converted_schema)], mark_converted);

// --- Conversion support ---
router.get(ROUTES.GET_PRE_ORDER_STOCK_READINESS, [jwtMiddleware], get_stock_readiness);
router.get(ROUTES.GET_BATCHES_FOR_PRODUCT, [jwtMiddleware, validator.get(batches_for_product_schema)], get_batches_for_product);

// --- Form support ---
router.get(ROUTES.GET_PRE_ORDER_NUMBER, [jwtMiddleware], get_pre_order_number);
router.get(ROUTES.GET_PRODUCT_LIST_FOR_PRE_ORDER, [jwtMiddleware, validator.get(product_list_schema)], get_product_list_for_pre_order);

// --- Reporting ---
router.post(ROUTES.GENERATE_PRE_ORDER_REPORT, [jwtMiddleware, validator.post(pre_order_details_schema)], generate_pre_order_report);
router.post(ROUTES.EXPORT_PRE_ORDER_DATA, [jwtMiddleware], export_pre_order_data);

module.exports = { preOrderRouter: router };
