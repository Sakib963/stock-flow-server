const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../middleware/validate-jwt');
const { validator } = require("../../../middleware/validator");
const { get_profile_info_schema } = require("./schema");
const get_profile_info = require("./controllers/get-profile-info");

const router = Router();

// Get User Profile Information
router.get(
      ROUTES.GET_PROFILE_INFO,
      [jwtMiddleware],
      get_profile_info
);

module.exports = { profileInfoRouter: router };