const Joi = require("joi");

const purchase_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const purchase_schema = Joi.object({
      oid: Joi.string().allow(null),
      supplier_oid: Joi.string().required(),
      total_amount: Joi.number().required(),
      special_notes: Joi.string().allow(null),
      payment_status: Joi.string().required(),
      paid_amount: Joi.number().required(),
      purchase_type: Joi.string().required(),
      products: Joi.array().items(
            Joi.object({
                  oid: Joi.string().allow(null),
                  product_oid: Joi.string().required(),
                  warehouse_oid: Joi.string().required(),
                  aisle_oid: Joi.string().allow(null),
                  quantity: Joi.number().required(),
                  unit_price: Joi.number().required(),
            })
      ).required()
});

const verify_purchase_schema = Joi.object({
      oid: Joi.string().allow(null),
      products: Joi.array().items(
            Joi.object({
                  oid: Joi.string().allow(null),
                  product_oid: Joi.string().required(),
                  verified_quantity: Joi.number().required(),
                  verified_unit_price: Joi.number().required(),
                  intended_use: Joi.string().valid('for_sale', 'internal_use').required(),
                  selling_price: Joi.number().when('intended_use', {
                        is: 'for_sale',
                        then: Joi.number().required(),
                        otherwise: Joi.number().optional().allow(null)
                  }),
                  maximum_discount: Joi.number().when('intended_use', {
                        is: 'for_sale',
                        then: Joi.number().required(),
                        otherwise: Joi.number().optional().allow(null)
                  })
            })
      ).required()
});

const purchase_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { purchase_list_schema, purchase_schema, purchase_details_schema, verify_purchase_schema };
