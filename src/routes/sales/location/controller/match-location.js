const { location_index } = require("../utils/location-index");
const { match_location: match } = require("../utils/match-location");
const { log } = require("../../../../utils/log");

const match_location = async (request, res) => {
    try {
        const result = match(await location_index(), request.body.text);
        return res.status(200).json({ code: 200, message: "Location candidates", data: result });
    } catch (e) {
        log.error(`An exception occurred while matching a location: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not read the place from that address. Pick the district and thana by hand." });
    }
};

module.exports = match_location;
