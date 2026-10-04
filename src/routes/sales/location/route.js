const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { location_search_schema, location_match_schema } = require("./schema");
const search_location = require("./controller/search-location");
const match_location = require("./controller/match-location");

const router = Router();

// The country's map, read by every form that takes an address: the customer's, the online order's,
// and the district filter on the customers list. It has no feature of its own to view.
const PLACE_READERS = ["sales.customer.view", "sales.online.view", "sales.order.view"];

router.get(ROUTES.SEARCH_LOCATION, [jwtMiddleware, requirePermission(PLACE_READERS), validator.get(location_search_schema)], search_location);

// A POST although it writes nothing: the text is a customer's address, which does not belong in a
// URL. The request log keeps it, as it keeps every customer write.
router.post(ROUTES.MATCH_LOCATION, [jwtMiddleware, requirePermission(PLACE_READERS), validator.post(location_match_schema)], match_location);

module.exports = { locationRouter: router };
