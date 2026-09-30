const Joi = require("joi");

const STATUSES = ["Draft", "Submitted", "Verified", "Cancelled"];
const PAYMENT_STATUSES = ["paid", "partially_paid", "unpaid"];
const PURCHASE_TYPES = ["instant", "advance", "overseas"];

// Whole taka, the same as every other money column. Prices fit numeric(8,0), quantities numeric(4,0).
const price = Joi.number().integer().min(0).max(99999999);
const quantity = Joi.number().integer().min(1).max(9999);
const budget = Joi.number().integer().min(0).max(99999999).allow(null).default(null);

const purchase_order_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("po_number", "supplier_name", "total_amount", "status", "created_on", "expected_delivery_date").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(new RegExp(`^(${STATUSES.join("|")})(,(${STATUSES.join("|")}))*$`)).allow(null, "").optional(),
      payment_status: Joi.string().pattern(new RegExp(`^(${PAYMENT_STATUSES.join("|")})(,(${PAYMENT_STATUSES.join("|")}))*$`)).allow(null, "").optional(),
      supplier_oid: Joi.string().uuid().allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const purchase_order_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const payment_fields = {
      payment_status: Joi.string().valid(...PAYMENT_STATUSES).required(),
      paid_amount: Joi.number().integer().min(0).allow(null).default(0),
};

// A draft is saved half typed: only the supplier is needed, and a line needs only its product.
// Submitting checks everything, so a draft is the one place these may be empty.
const optional = (schema) => schema.allow(null, "").empty("").default(null);
const draftOr = (draft, full) => Joi.when("/draft", { is: true, then: draft, otherwise: full });

const line = Joi.object({
      product_oid: Joi.string().uuid().required(),
      warehouse_oid: draftOr(optional(Joi.string().uuid()), Joi.string().uuid().required()),
      aisle_oid: optional(Joi.string().uuid()),
      quantity: draftOr(optional(quantity), quantity.required()),
      unit_price: draftOr(optional(price), price.required()),
});

const order_fields = {
      draft: Joi.boolean().default(false),
      supplier_oid: Joi.string().uuid().required(),
      purchase_type: draftOr(optional(Joi.string().valid(...PURCHASE_TYPES)), Joi.string().valid(...PURCHASE_TYPES).required()),
      expected_delivery_date: optional(Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)),
      special_notes: optional(Joi.string().trim().max(1000)),
      products: draftOr(Joi.array().max(200).items(line).default([]), Joi.array().min(1).max(200).items(line).required()),
};

const purchase_order_create_schema = Joi.object({
      ...order_fields,
      payment_status: draftOr(optional(Joi.string().valid(...PAYMENT_STATUSES)), payment_fields.payment_status),
      paid_amount: payment_fields.paid_amount,
});

// Payment is sent only while the order is a Draft, whose payment lives in the form. Once submitted it
// changes through Record payment alone, and the server refuses it here, so an edit opened before a
// payment was recorded cannot put the old one back.
const purchase_order_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...order_fields,
      payment_status: optional(Joi.string().valid(...PAYMENT_STATUSES)),
      paid_amount: Joi.number().integer().min(0).allow(null).optional(),
});

const purchase_order_payment_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...payment_fields,
});

const purchase_order_cancel_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      reason: Joi.string().trim().min(3).max(500).required(),
});

// A calendar day, kept as text end to end: a Date would shift a day across the business's timezone.
const expiry_date = Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .custom((value, helpers) => (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : helpers.error("any.invalid")))
      .allow(null, "")
      .empty("")
      .default(null);

// Selling price and max discount only mean something for stock that is for sale; internal use stock
// is never sold, so they are dropped rather than stored.
const purchase_order_verify_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      lines: Joi.array()
            .min(1)
            .max(200)
            .items(
                  Joi.object({
                        oid: Joi.string().uuid().required(),
                        received_quantity: Joi.number().integer().min(0).max(9999).required(),
                        unit_price: price.required(),
                        intended_use: Joi.string().valid("for_sale", "internal_use").required(),
                        selling_price: Joi.when("intended_use", { is: "for_sale", then: price.min(1).required(), otherwise: Joi.any().strip() }),
                        maximum_discount: Joi.when("intended_use", { is: "for_sale", then: price.max(Joi.ref("selling_price")).required(), otherwise: Joi.any().strip() }),
                        ad_run_cost: budget,
                        packaging_cost: budget,
                        gift_cost: budget,
                        content_creation_cost: budget,
                        influencer_cost: budget,
                        cost_remarks: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
                        expiry_date,
                  })
            )
            .required(),
});

const batch_expiry_schema = Joi.object({
      inventory_oid: Joi.string().uuid().required(),
      expiry_date,
});

const purchase_product_picker_schema = Joi.object({
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = {
      STATUSES,
      purchase_order_list_schema,
      purchase_order_oid_schema,
      purchase_order_create_schema,
      purchase_order_update_schema,
      purchase_order_payment_schema,
      purchase_order_cancel_schema,
      purchase_order_verify_schema,
      batch_expiry_schema,
      purchase_product_picker_schema,
};
