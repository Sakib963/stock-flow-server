const Joi = require("joi");

const oid_list = Joi.string().pattern(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i).allow(null, "").optional();
const money = Joi.number().integer().min(0).max(100000000);
const budget = money.allow(null).empty("").default(null);

const stock_overview_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "on_hand", "sellable", "batches", "stock_value", "expected_revenue", "profit_full").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      category_oid: oid_list,
      sub_category_oid: oid_list,
      brand_oid: oid_list,
      stock_status: Joi.string().pattern(/^(in|low|out)(,(in|low|out))*$/).allow(null, "").optional(),
      expiry_state: Joi.string().pattern(/^(expired|soon)(,(expired|soon))*$/).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const product_stock_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

// A price of at least 1 and a discount no larger than it: the old endpoint took 0 and any discount.
const batch_pricing_schema = Joi.object({
      inventory_oid: Joi.string().uuid().required(),
      selling_price: money.min(1).required(),
      maximum_discount: money.max(Joi.ref("selling_price")).required(),
});

const batch_budget_schema = Joi.object({
      inventory_oid: Joi.string().uuid().required(),
      ad_run_cost: budget,
      packaging_cost: budget,
      gift_cost: budget,
      content_creation_cost: budget,
      influencer_cost: budget,
      cost_remarks: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
});

module.exports = { stock_overview_list_schema, product_stock_schema, batch_pricing_schema, batch_budget_schema };
