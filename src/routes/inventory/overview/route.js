const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { stock_overview_list_schema, product_stock_schema, batch_pricing_schema, batch_budget_schema } = require("./schema");
const get_stock_overview_list = require("./controller/get-stock-overview-list");
const get_product_stock = require("./controller/get-product-stock");
const update_batch_pricing = require("./controller/update-batch-pricing");
const update_batch_budget = require("./controller/update-batch-budget");

const router = Router();

router.get(ROUTES.GET_STOCK_OVERVIEW_LIST, [jwtMiddleware, requirePermission("inventory.overview.view"), validator.get(stock_overview_list_schema)], get_stock_overview_list);

router.get(ROUTES.GET_PRODUCT_STOCK + "/:oid", [jwtMiddleware, requirePermission("inventory.overview.view"), validator.params(product_stock_schema)], get_product_stock);

router.post(ROUTES.UPDATE_BATCH_PRICING, [jwtMiddleware, requirePermission("inventory.overview.edit"), validator.post(batch_pricing_schema)], update_batch_pricing);

// A budget is money: changing one needs the permission to see it as well as to edit.
router.post(ROUTES.UPDATE_BATCH_BUDGET, [jwtMiddleware, requirePermission("inventory.overview.edit"), requirePermission("inventory.stock-value.view"), validator.post(batch_budget_schema)], update_batch_budget);

module.exports = { inventoryOverviewRouter: router };
