const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { lookup_customer } = require("../../customer/utils/lookup");
const { location_index } = require("../../location/utils/location-index");
const { match_location } = require("../../location/utils/match-location");
const { read_message } = require("../utils/read-message");

// The order helper (sales REQ-34, REQ-35): one answer for a pasted message, with what it read, the
// places the address can mean, and the customer behind the phone. It never picks a place alone.
const read_chat_message = async (request, res) => {
    try {
        const read = read_message(request.body.text);
        const [location, lookup] = await Promise.all([read.place_text ? location_index().then((index) => match_location(index, read.place_text)) : null, read.phone ? channels_of(request).then((channels) => lookup_customer(read.phone, channels)) : null]);
        return res.status(200).json({ code: 200, message: "Message read", data: { ...read, location, lookup } });
    } catch (e) {
        log.error(`An exception occurred while reading a chat message: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not read that message. Type the phone and address instead." });
    }
};

module.exports = read_chat_message;
