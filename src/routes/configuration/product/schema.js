const Joi = require("joi");
const { is_own_photo } = require("./utils/photo");

const UNITS = ["pcs", "pair", "set", "dozen", "box", "pack", "kg", "g", "l", "m"];

const oid_list = Joi.string().pattern(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i).allow(null, "").optional();

const product_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "sku", "stock", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      category_oid: oid_list,
      sub_category_oid: oid_list,
      brand_oid: oid_list,
      include: Joi.string().valid("", "stats").optional(),
});

const product_dropdown_schema = Joi.object({
      grouped: Joi.boolean().optional(),
});

const product_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

// A URL the browser got back from our own Cloudinary account, never an address someone typed.
const photo = Joi.string()
      .trim()
      .max(1000)
      .custom((value, helpers) => (is_own_photo(value) ? value : helpers.error("any.invalid")))
      .allow(null, "")
      .empty("")
      .default(null);

const product_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      // Blank asks the server to generate one. Letters, digits, dot, dash and underscore, so a
      // manufacturer's barcode fits and a scanner reads back exactly what was stored.
      sku: Joi.string().trim().uppercase().max(64).pattern(/^[A-Z0-9._-]+$/).allow(null, "").empty("").default(null),
      sub_category_oid: Joi.string().uuid().required(),
      brand_oid: Joi.string().uuid().allow(null, "").empty("").default(null),
      unit_type: Joi.string().valid(...UNITS).allow(null, "").empty("").default(null),
      restock_threshold: Joi.number().integer().min(0).max(9999).required(),
      description: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      photo,
      status: Joi.string().valid("Active", "Inactive").required(),
};

const product_create_schema = Joi.object({ ...product_fields, has_expiry: Joi.boolean().default(false) });

// Left out, the product keeps its setting: an older client must not switch expiry off by omission.
const product_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...product_fields,
      has_expiry: Joi.boolean().optional(),
});

// `oid` is the product being edited, so its own SKU is not reported as taken.
const product_availability_schema = Joi.object({
      value: Joi.string().trim().min(1).max(64).required(),
      oid: Joi.string().uuid().optional(),
});

const product_sku_generate_schema = Joi.object({
      name: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const product_photo_sign_schema = Joi.object({});

const product_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { product_list_schema, product_dropdown_schema, product_oid_schema, product_create_schema, product_update_schema, product_availability_schema, product_sku_generate_schema, product_photo_sign_schema, product_details_schema };
