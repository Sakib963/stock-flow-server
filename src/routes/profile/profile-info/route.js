const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const { get_profile_info_schema, sign_profile_photo_schema, update_profile_info_schema } = require("./schema");
const get_profile_info = require("./controllers/get-profile-info");
const update_profile_info = require("./controllers/update-profile-info");
const sign_profile_photo_upload = require("./controllers/sign-profile-photo-upload");

// A person's own profile, with no permission on purpose (decided by the user, 2026-10-12): every
// signed-in person has one, and each query is held to the caller's own row by login_oid.
const router = Router();

router.get(ROUTES.GET_PROFILE_INFO, [jwtMiddleware, validator.get(get_profile_info_schema)], get_profile_info);
router.post(ROUTES.UPDATE_PROFILE_INFO, [jwtMiddleware, validator.post(update_profile_info_schema)], update_profile_info);
router.post(ROUTES.SIGN_PROFILE_PHOTO_UPLOAD, [jwtMiddleware, validator.post(sign_profile_photo_schema)], sign_profile_photo_upload);

module.exports = { profileInfoRouter: router };
