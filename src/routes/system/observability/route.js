const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { range_schema, request_list_schema, request_oid_schema, empty_schema } = require("./schema");
const get_observability_usage = require("./controller/get-observability-usage");
const get_route_metrics = require("./controller/get-route-metrics");
const get_request_list = require("./controller/get-request-list");
const get_request_details = require("./controller/get-request-details");
const get_signals = require("./controller/get-signals");
const get_database_status = require("./controller/get-database-status");
const get_crash_list = require("./controller/get-crash-list");

const VIEW = "system.observability.view";
const router = Router();

router.get(ROUTES.GET_OBSERVABILITY_USAGE, [jwtMiddleware, requirePermission(VIEW), validator.get(range_schema)], get_observability_usage);
router.get(ROUTES.GET_ROUTE_METRICS, [jwtMiddleware, requirePermission(VIEW), validator.get(range_schema)], get_route_metrics);
router.get(ROUTES.GET_REQUEST_LIST, [jwtMiddleware, requirePermission(VIEW), validator.get(request_list_schema)], get_request_list);
router.get(ROUTES.GET_REQUEST_DETAILS + "/:oid", [jwtMiddleware, requirePermission(VIEW), validator.params(request_oid_schema)], get_request_details);
router.get(ROUTES.GET_SIGNALS, [jwtMiddleware, requirePermission(VIEW), validator.get(range_schema)], get_signals);
router.get(ROUTES.GET_DATABASE_STATUS, [jwtMiddleware, requirePermission(VIEW), validator.get(empty_schema)], get_database_status);
router.get(ROUTES.GET_CRASH_LIST, [jwtMiddleware, requirePermission(VIEW), validator.get(range_schema)], get_crash_list);

module.exports = { observabilityRouter: router };
