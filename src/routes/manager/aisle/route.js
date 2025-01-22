const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { aisle_list_schema, aisle_list_for_dropdown_schema, aisle_schema, aisle_details_schema } = require("./schema");
const get_aisle_list = require("./controller/get-aisle-list");
const get_aisle_list_for_dropdown = require("./controller/get-aisle-list-for-dropdown");
const create_aisle = require("./controller/create-aisle");
const update_aisle_details = require("./controller/update-aisle-details");
const get_aisle_details = require("./controller/get-aisle-details");

const router = Router();

// Get Aisle List
router.get(
      ROUTES.GET_AISLE_LIST,
      [jwtMiddleware, validator.get(aisle_list_schema)],
      get_aisle_list
);

// Get Aisle List for dropdown
router.get(
      ROUTES.GET_AISLE_LIST_FOR_DROPDOWN,
      [jwtMiddleware, validator.get(aisle_list_for_dropdown_schema)],
      get_aisle_list_for_dropdown
);

// Create A New Aisle
router.post(
      ROUTES.CREATE_AISLE,
      [jwtMiddleware, validator.post(aisle_schema)],
      create_aisle
);

// Update New Aisle
router.post(
      ROUTES.UPDATE_AISLE_DETAILS,
      [jwtMiddleware, validator.post(aisle_schema)],
      update_aisle_details
);

// Get Aisle Details
router.get(
      ROUTES.GET_AISLE_DETAILS,
      [jwtMiddleware, validator.get(aisle_details_schema)],
      get_aisle_details
);

module.exports = { aisleRouter: router };