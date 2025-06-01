const Joi = require("joi");

const product_list_schema = Joi.object({
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const sales_schema = Joi.object({
      oid: Joi.string().allow(null),
      invoice_no: Joi.string().required(),
      customer_name: Joi.string().allow(null),
      customer_phone: Joi.string().allow(null),
      customer_address: Joi.string().allow(null),
      customer_email: Joi.string().allow(null),
      payment_method: Joi.string().valid('cash', 'bkash').required(),
      payment_reference: Joi.string().allow(null),
      payment_status: Joi.string().valid('paid', 'partially_paid', 'unpaid').required(),
      notes: Joi.string().allow(null),
      status: Joi.string().required(),
      total_amount: Joi.number().min(0).required(),
      products: Joi.array().items(Joi.object({
            inventory_oid: Joi.string().required(),
            product_name: Joi.string().required(),
            product_oid: Joi.string().required(),
            quantity_available: Joi.number().min(0).required(),
            quantity: Joi.number().min(1).required(),
            unit_price: Joi.number().min(0).required(),
            discount: Joi.number().min(0).allow(null),
            total: Joi.number().min(0).required()
      }).required()).required()
});

const invoice_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_list_schema, sales_schema, invoice_details_schema };
