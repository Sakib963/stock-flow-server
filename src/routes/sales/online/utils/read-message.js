const { normalize_phone } = require("../../utils/phone");

const western_digits = (text) => text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

// Phone-like runs: an optional +88 or 88, then 01 and nine more digits, spaces or dashes allowed.
const PHONE_RUN = /(?:\+?\s*88[\s-]*)?0[\s-]*1(?:[\s-]*\d){9}/g;

// The labels customers write, in English, Bengali and Bengali typed in Latin letters.
const LABELS = [
    ["name", /^(name|nam|customer name|customer|নাম|কাস্টমার|গ্রাহক)$/],
    ["phone", /^(phone|phone number|phone no|mobile|mobile number|mobile no|mob|contact|contact number|number|cell|ফোন|মোবাইল|মোবাইল নাম্বার|মোবাইল নম্বর|নাম্বার|নম্বর)$/],
    ["address", /^(address|full address|delivery address|addr|tekana|thikana|ঠিকানা|এড্রেস|বাসা|location)$/],
    ["area", /^(area|elaka|এলাকা|গ্রাম|gram|village|union|ইউনিয়ন)$/],
    ["thana", /^(thana|upazila|upozila|upojela|upazilla|police station|ps|থানা|উপজেলা)$/],
    ["district", /^(district|dist|jela|jila|zila|zilla|zela|জেলা|জিলা)$/],
    ["postal", /^(post code|postcode|postal code|post|zip|পোস্ট কোড|পোস্ট)$/],
];

const label_of = (line) => {
    const match = line.match(/^\s*([\p{L}\p{M} .]+?)\s*[:：ঃ=\-–]\s*(.*)$/u);
    if (!match) return null;
    const label = match[1].trim().toLowerCase().replace(/\s+/g, " ");
    const found = LABELS.find(([, pattern]) => pattern.test(label));
    return found ? { key: found[0], value: match[2].trim() } : null;
};

// What is not an address: product lines, prices, the delivery charge and the total of the order
// a customer often pastes with it ("Cotton pads 80pcs 190tk", "DC 120tk", "Total 810tk").
const ORDER_LINE = /\d\s*(tk|taka|৳|টাকা|bdt|\/-)|(^|\s)(total|subtotal|dc|delivery charge|delivery|qty|pcs|price|মোট|ডেলিভারি)(\s|:|$)|[x×]\s*\d|\d\s*(pcs|pc|pieces|ml|gm|g|kg)\b/i;

const tidy = (text) =>
    text
        .replace(/\s+/g, " ")
        .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "")
        .trim();

// "person a" becomes "Person A"; a name typed with capitals, or in Bengali, is left as written.
const capitalise = (name) => (name && name === name.toLowerCase() ? name.replace(/(^|\s)(\p{Ll})/gu, (_, space, letter) => space + letter.toUpperCase()) : name);

const looks_like_name = (part) => !!part && !/\d/.test(part) && part.split(/\s+/).length <= 4;

/**
 * Reads a pasted chat message (sales REQ-34): the templates customers fill in English and Bengali,
 * with name, phone, address, area, thana, district and post code labelled, and free text where the
 * name comes before the phone and the address after it. Lines about the products and the money are
 * never part of the address. The first mobile number is the customer's; any other is offered as the
 * recipient's. The place is not decided here: `place_text` goes to the location matcher.
 */
const read_message = (raw) => {
    const text = western_digits(String(raw ?? ""));
    const phones = [...new Set((text.match(PHONE_RUN) ?? []).map(normalize_phone).filter(Boolean))];
    const without_phones = (part) => tidy(part.replace(PHONE_RUN, " "));

    const fields = {};
    const loose = [];
    for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const labelled = label_of(line);
        if (labelled) {
            if (labelled.value && !fields[labelled.key]) fields[labelled.key] = labelled.value;
        } else if (!ORDER_LINE.test(line)) loose.push(line);
    }

    let name = fields.name ? tidy(fields.name) : null;
    let address = fields.address ? without_phones(fields.address) : null;
    // A filled template says where everything is, so the lines around it are left alone.
    const templated = !!(fields.address || fields.thana || fields.district);

    if (!templated && loose.length === 1) {
        // One line of free text: the name before the phone, the address after it.
        const line = loose[0];
        const at = line.search(PHONE_RUN);
        const before = at > 0 ? tidy(line.slice(0, at)) : "";
        const after = at >= 0 ? without_phones(line.slice(at)) : tidy(line);
        const parts = after.split(",").map(tidy).filter(Boolean);
        if (!name && looks_like_name(before)) name = before;
        else if (!name && !before && looks_like_name(parts[0]) && parts.length > 1) name = parts.shift();
        address = (before && !looks_like_name(before) ? [before, ...parts] : parts).join(", ") || null;
    } else if (!templated && loose.length > 1) {
        // A line holding a phone is that phone's line ("or call my husband 018..."), not the name or address.
        const lines = loose.filter((l) => !l.match(PHONE_RUN)?.some(normalize_phone)).map(tidy).filter(Boolean);
        if (!name) name = lines.find(looks_like_name) ?? null;
        address = lines.filter((l) => l !== name).join(", ") || null;
    }

    const area = fields.area ? tidy(fields.area) : null;
    const thana = fields.thana ? tidy(fields.thana) : null;
    const district = fields.district ? tidy(fields.district) : null;
    const postal_code = fields.postal?.match(/\d{4}/)?.[0] ?? null;
    const address_line = [address, area].filter(Boolean).join(", ") || null;
    const place_text = [address_line, thana, district, postal_code].filter(Boolean).join(", ") || null;

    return { phone: phones[0] ?? null, other_phones: phones.slice(1), name: capitalise(name) || null, address_line, area, place_text };
};

module.exports = { read_message };
