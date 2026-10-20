// The stock reports by the key a request names them with (docs/report REQ-13 to REQ-19, REQ-25, REQ-26).
const STOCK_REPORTS = {
    "stock-on-hand": require("./stock-on-hand"),
    "stock-movement-summary": require("./stock-movement-summary"),
    "reorder-list": require("./reorder-list"),
    "expiring-stock": require("./expiring-stock"),
    "purchases-received": require("./purchases-received"),
    "supplier-dues": require("./supplier-dues"),
    disposals: require("./disposals"),
    "stock-adjustments": require("./stock-adjustments"),
};

module.exports = { STOCK_REPORTS };
