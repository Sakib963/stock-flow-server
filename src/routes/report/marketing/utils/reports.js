// The marketing reports by the key a request names them with (docs/report REQ-35 to REQ-38).
const MARKETING_REPORTS = {
    "sales-by-source": require("./sales-by-source"),
    "campaign-costs": require("./campaign-costs"),
    "partner-payments": require("./partner-payments"),
    "partner-dues": require("./partner-dues"),
    giveaways: require("./giveaways"),
};

module.exports = { MARKETING_REPORTS };
