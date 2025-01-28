const Joi = require("joi");

const product_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const purchase_schema = Joi.object({
      oid: Joi.string().allow(null),
      bill_no: Joi.string().required(),
      date_of_purchase: Joi.string().required(),
      supplier_oid: Joi.string().required(),
      total_amount: Joi.number().required(),
      special_notes: Joi.string().allow(null),
      status: Joi.string().allow(null),
      products: Joi.array().items(
            Joi.object({
                  oid: Joi.string().allow(null),
                  product_oid: Joi.string().required(),
                  product_name: Joi.string().required(),
                  warehouse_oid: Joi.string().required(),
                  warehouse_name: Joi.string().required(),
                  aisle_oid: Joi.string().allow(null),
                  aisle_name: Joi.string().allow(null),
                  quantity: Joi.number().required(),
                  unit_price: Joi.number().required(),
                  total_price: Joi.number().required(),
            })
      ).required()
});

const product_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_list_schema, purchase_schema, product_details_schema };
