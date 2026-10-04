const { location_key } = require("./location-index");

const LONGEST_NAME_WORDS = 4;

const western_digits = (text) => text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

// Every run of up to four words, keyed, so "Sher-e-Bangla Nagar" and "sherebangla nagar" both
// meet the seeded key.
const word_runs = (text) => {
    const words = text.split(/[\s,;|]+/).filter(Boolean);
    const keys = new Set();
    for (let start = 0; start < words.length; start++) {
        for (let length = 1; length <= LONGEST_NAME_WORDS && start + length <= words.length; length++) {
            const key = location_key(words.slice(start, start + length).join(""));
            if (key.length >= 2 && !/^\d+$/.test(key)) keys.add(key);
        }
    }
    return keys;
};

const by_rank = (a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
    return 0;
};

/**
 * The places an address can mean, best first (sales REQ-81 to REQ-84). Ranked by post code, then a
 * district named in the text, then areas learned under the thana, then the business's most common
 * district. Equal scores share a rank: a tie stays a tie for the person to settle.
 */
const match_location = (index, text) => {
    const plain = western_digits(String(text ?? ""));
    const postal_code = (plain.match(/(?<!\d)\d{4}(?!\d)/g) ?? []).find((code) => index.thanas_by_postcode.has(code)) ?? null;
    const runs = word_runs(plain);

    const named_districts = new Set();
    const named_thanas = new Set();
    const named_areas = [];
    for (const key of runs) {
        for (const oid of index.district_by_key.get(key) ?? []) named_districts.add(oid);
        for (const oid of index.thana_by_key.get(key) ?? []) named_thanas.add(oid);
        // Words that already named a thana or district are not an area too: Magura's Mohammadpur
        // has a Mohammadpur union, which would otherwise outrank Dhaka on the thana's own name.
        if (index.district_by_key.has(key) || index.thana_by_key.has(key)) continue;
        for (const area of index.area_by_key.get(key) ?? []) named_areas.push(area);
    }

    // A union shares its name with places all over the country, so an area only proposes a thana
    // when nothing in the text named one.
    let candidates = new Set(named_thanas);
    if (!candidates.size) for (const area of named_areas) candidates.add(area.thana_oid);

    const postcode_thanas = postal_code ? index.thanas_by_postcode.get(postal_code) : new Set();
    const postcode_districts = new Set([...postcode_thanas].map((oid) => index.thana.get(oid).district_oid));
    if (postal_code) {
        const inside = [...candidates].filter((oid) => postcode_districts.has(index.thana.get(oid).district_oid));
        candidates = new Set(inside.length ? inside : postcode_thanas);
    }

    const rows = [...candidates].map((thana_oid) => {
        const thana = index.thana.get(thana_oid);
        const areas = named_areas.filter((a) => a.thana_oid === thana_oid);
        const area_score = areas.reduce((sum, a) => sum + a.times_used + 1, 0);
        const best_area = areas.sort((a, b) => b.times_used - a.times_used)[0] ?? null;
        return { district_oid: thana.district_oid, thana, area: best_area, score: [postcode_thanas.has(thana_oid) ? 1 : 0, named_districts.has(thana.district_oid) ? 1 : 0, area_score, index.district_orders.get(thana.district_oid) ?? 0] };
    });

    // A district named with no thana the text can be tied to still narrows the choice to it.
    const covered = new Set(rows.map((r) => r.district_oid));
    for (const district_oid of named_districts) {
        if (!covered.has(district_oid) && (!postal_code || postcode_districts.has(district_oid))) rows.push({ district_oid, thana: null, area: null, score: [0, 1, 0, index.district_orders.get(district_oid) ?? 0] });
    }

    rows.sort(by_rank);

    let rank = 0;
    return {
        postal_code,
        candidates: rows.map((row, i) => {
            if (i === 0 || by_rank(rows[i - 1], row) !== 0) rank = i + 1;
            const district = index.district.get(row.district_oid);
            const [postcode, named, area, common] = row.score;
            return {
                rank,
                district: { oid: district.oid, name_en: district.name_en, name_bn: district.name_bn },
                thana: row.thana && { oid: row.thana.oid, name_en: row.thana.name_en, name_bn: row.thana.name_bn, type: row.thana.type },
                area: row.area && { oid: row.area.oid, name_en: row.area.name_en, name_bn: row.area.name_bn, kind: row.area.kind },
                reasons: [postcode && "postcode", named && "district", area && "area", common && "common_district"].filter(Boolean),
            };
        }),
    };
};

module.exports = { match_location };
