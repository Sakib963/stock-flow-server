// The customer reports by the key a request names them with (docs/report REQ-30 to REQ-33).
const CUSTOMER_REPORTS = {
    "customer-list": require("./customer-list"),
    "customers-by-district": require("./customers-by-district"),
    "customers-by-age-gender": require("./customers-by-age-gender"),
    "customers-gone-quiet": require("./customers-gone-quiet"),
};

module.exports = { CUSTOMER_REPORTS };
