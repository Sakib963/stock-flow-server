const { parseDeliveryDetails } = require("../../../../utils/smart-fill");
const { log } = require("../../../../utils/log");

// Parse a pasted Facebook/Messenger message into delivery fields ONLY
// (name, phone, address). Never returns products. The admin reviews & edits.
const smart_fill = async (request, res) => {
    try {
        const text = request.body?.text || "";
        if (!String(text).trim()) {
            return res.status(400).json({ code: 400, message: "Paste a message to parse" });
        }
        const data = parseDeliveryDetails(text);
        log.info(`Smart Fill parsed: name=${!!data.name} phone=${!!data.phone} address=${!!data.address}`);
        return res.status(200).json({ code: 200, message: "Delivery details parsed", data });
    } catch (e) {
        log.error(`An exception occurred during Smart Fill: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = smart_fill;
