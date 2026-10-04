const { location_index, location_key } = require("../utils/location-index");
const { log } = require("../../../../utils/log");

// The type-ahead behind picking a district or thana by hand (sales REQ-85). Names that start with
// what was typed come before names that only contain it.
const search_location = async (request, res) => {
    const { level, search, district_oid, limit } = request.query;
    try {
        const index = await location_index();
        const typed = location_key(search);
        const places = level === "District" ? [...index.district.values()] : [...index.thana.values()].filter((t) => !district_oid || t.district_oid === district_oid);

        const found = [];
        for (const place of places) {
            const fit = !typed ? 1 : place.keys.some((k) => k.startsWith(typed)) ? 1 : place.keys.some((k) => k.includes(typed)) ? 2 : 0;
            if (fit) found.push({ fit, place });
        }
        found.sort((a, b) => a.fit - b.fit || a.place.name_en.localeCompare(b.place.name_en));

        const data = found.slice(0, limit).map(({ place }) => {
            const district = index.district.get(place.district_oid ?? place.oid);
            return level === "District"
                ? { oid: place.oid, name_en: place.name_en, name_bn: place.name_bn }
                : { oid: place.oid, name_en: place.name_en, name_bn: place.name_bn, type: place.type, postal_code: place.postal_code, district: { oid: district.oid, name_en: district.name_en, name_bn: district.name_bn } };
        });
        return res.status(200).json({ code: 200, message: "Locations", data, total: found.length });
    } catch (e) {
        log.error(`An exception occurred while searching locations: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not search places. Try again in a moment." });
    }
};

module.exports = search_location;
