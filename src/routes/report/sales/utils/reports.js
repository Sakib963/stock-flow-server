// The sales reports by the key a request names them with (docs/report REQ-08 to REQ-12, REQ-27, REQ-28).
const SALES_REPORTS = {
    "sales-register": require("./sales-register"),
    "daily-sales": require("./daily-sales"),
    "sales-by-product": require("./sales-by-product"),
    "profit-by-category": require("./profit-by-category"),
    returns: require("./returns"),
    "customer-dues": require("./customer-dues"),
    "cod-with-couriers": require("./cod-with-couriers"),
    "pre-order-deposits": require("./pre-order-deposits"),
};

module.exports = { SALES_REPORTS };
