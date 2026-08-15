// -----------------------------------------------------------------------------
// Smart Fill: rule-based parser that extracts DELIVERY DETAILS ONLY
// (name, phone, and a structured address) from a pasted Facebook/Messenger reply.
//
// Businesses ask the customer to fill a template like:
//     Name:
//     Address:
//     Phone number:
// The customer replies with the values, e.g. an address like
//     h-22, r-008, shekhertek, mohammadpur, dhaka 1207
// We split that address into the pieces Pathao needs and we store:
//     address   -> RecipientAddress(*)  (the full human-readable line)
//     city      -> RecipientCity(*)     (district / metro city)
//     zone      -> RecipientZone(*)     (thana / region)
//     area      -> RecipientArea        (sub-area, optional)
//     postcode  -> 4-digit postal code
//
// Handles mixed Bengali + English, Bengali digits, and labeled or free-form text.
// It never touches products. The admin reviews/edits the result before saving.
// No external service / LLM -- pure deterministic rules.
// -----------------------------------------------------------------------------

// Bengali digits ০১২৩৪৫৬৭৮৯ -> 0-9
const normalizeDigits = (s) => {
    const map = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };
    return s.replace(/[০-৯]/g, (d) => map[d] ?? d);
};

const titleCase = (s) =>
    String(s || "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

// Labels that mark each field, in English and Bengali.
const LABELS = {
    name: ["name", "customer name", "customer", "নাম", "নামঃ", "কাস্টমার"],
    phone: ["phone", "phone number", "mobile", "mobile number", "mob", "contact", "number", "cell", "ফোন", "মোবাইল", "নাম্বার", "নম্বর", "মোবাইল নাম্বার"],
    address: ["address", "addr", "location", "full address", "delivery address", "ঠিকানা", "এড্রেস", "ঠিকানাঃ"],
};

// Known BD districts / metro cities (RecipientCity). Both common spellings kept.
const KNOWN_CITIES = [
    "dhaka", "chattogram", "chittagong", "gazipur", "narayanganj", "savar", "keraniganj",
    "cumilla", "comilla", "sylhet", "khulna", "rajshahi", "barishal", "barisal", "rangpur",
    "mymensingh", "bogura", "bogra", "jashore", "jessore", "narsingdi", "tangail", "cox's bazar",
    "coxs bazar", "feni", "brahmanbaria", "noakhali", "kishoreganj", "manikganj", "munshiganj",
    "faridpur", "pabna", "sirajganj", "dinajpur", "jamalpur", "kushtia", "jhenaidah", "magura",
];

// Common Dhaka thanas / Pathao zones (RecipientZone). Used to recognise the region
// inside a free-form address and, when a zone is present without a city, to infer Dhaka.
const DHAKA_ZONES = [
    "uttara", "uttarkhan", "dakshinkhan", "airport", "khilkhet", "cantonment", "kafrul",
    "mirpur", "pallabi", "kazipara", "shewrapara", "kalshi", "mohammadpur", "adabor", "shyamoli",
    "mohakhali", "banani", "gulshan", "baridhara", "bashundhara", "badda", "rampura", "banasree",
    "aftabnagar", "khilgaon", "malibagh", "mugda", "manda", "sabujbagh", "dhanmondi", "kalabagan",
    "hazaribagh", "lalbagh", "azimpur", "new market", "elephant road", "farmgate", "tejgaon",
    "kawran bazar", "karwan bazar", "motijheel", "paltan", "shantinagar", "kakrail", "eskaton",
    "gopibagh", "wari", "sutrapur", "gendaria", "jatrabari", "demra", "shonir akhra", "kadamtali",
    "shyampur", "postogola", "shahbagh", "segunbagicha", "bijoy sarani", "nakhalpara", "shekhertek",
    "keraniganj", "savar", "ashulia", "tongi", "narayanganj",
];

// Segments that describe a house / road / block rather than a place name.
const looksLikeHouseRoad = (part) => {
    const low = String(part || "").trim().toLowerCase();
    if (!low) return true;
    if (/^\d+$/.test(low)) return true;
    if (/^(house|home|bari|basa|flat|apt|apartment|road|block|sector|avenue|lane|plot|holding|floor|level)\b/.test(low)) return true;
    // Bengali house/road words: বাসা / বাড়ি / রোড / ব্লক / সেক্টর / ফ্ল্যাট / হোল্ডিং.
    if (/^(বাসা|বাড়ি|রোড|ব্লক|সেক্টর|ফ্ল্যাট|হোল্ডিং|প্লট|তলা)/.test(low)) return true;
    // Short coded forms like "h-22", "r-008", "b-3", "s-6", "fl-2".
    if (/^(h|r|b|s|f|fl)[-#\s.]*\d/.test(low)) return true;
    return false;
};

const containsToken = (haystackLower, token) => new RegExp(`(^|[^a-z])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(haystackLower);

// Split a plain address line into { address, city, zone, area, postcode }.
const parseAddress = (rawLine) => {
    const address = normalizeDigits(String(rawLine || "")).replace(/\s+/g, " ").trim();
    if (!address) return { address: null, city: null, zone: null, area: null, postcode: null };

    // Postcode: last standalone 4-digit group in the line.
    let postcode = null;
    const postMatches = address.match(/\b\d{4}\b/g);
    if (postMatches && postMatches.length) postcode = postMatches[postMatches.length - 1];

    const parts = address.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);

    // City: a known city token, scanning comma-parts from the end (closest to postcode).
    let city = null;
    let cityIdx = -1;
    let cityFromDict = false;
    for (let i = parts.length - 1; i >= 0 && cityIdx === -1; i--) {
        const low = parts[i].toLowerCase();
        for (const c of KNOWN_CITIES) {
            if (containsToken(low, c)) {
                city = titleCase(c);
                cityIdx = i;
                cityFromDict = true;
                break;
            }
        }
    }
    if (cityIdx === -1 && parts.length) {
        // Fallback: the last comma segment (minus any postcode) is probably the city.
        cityIdx = parts.length - 1;
        const guess = parts[cityIdx].replace(/\b\d{4}\b/g, "").trim();
        city = guess ? titleCase(guess) : null;
    }

    let zone = null;
    let zoneIdx = -1;

    // A Dhaka thana mistaken for the city (e.g. "... Uttara 1230" with no district)
    // is really the zone; default the city to Dhaka in that case.
    if (city && !cityFromDict && DHAKA_ZONES.includes(city.toLowerCase())) {
        zone = city;
        zoneIdx = cityIdx;
        city = "Dhaka";
    }

    // Zone: a known Dhaka zone anywhere, else the comma-part just before the city.
    if (zoneIdx === -1) {
        for (let i = parts.length - 1; i >= 0 && zoneIdx === -1; i--) {
            if (i === cityIdx) continue;
            const low = parts[i].toLowerCase();
            for (const z of DHAKA_ZONES) {
                if (containsToken(low, z)) {
                    zone = titleCase(z);
                    zoneIdx = i;
                    break;
                }
            }
        }
    }
    if (zoneIdx === -1 && cityIdx > 0) {
        const cand = parts[cityIdx - 1];
        if (!looksLikeHouseRoad(cand)) {
            zone = titleCase(cand);
            zoneIdx = cityIdx - 1;
        }
    }

    // Area: the comma-part just before the zone (skip house/road-ish segments).
    let area = null;
    const beforeIdx = (zoneIdx !== -1 ? zoneIdx : cityIdx) - 1;
    if (beforeIdx >= 0) {
        const cand = parts[beforeIdx];
        if (cand && !looksLikeHouseRoad(cand)) area = titleCase(cand);
    }

    return { address, city, zone, area, postcode };
};

const stripLabel = (line) => {
    // Return { key, value } if the line starts with a known label + separator.
    const m = line.match(/^\s*([A-Za-zঀ-৿ .]+?)\s*[:：\-–]\s*(.+)$/);
    if (!m) return null;
    const label = m[1].trim().toLowerCase();
    const value = m[2].trim();
    for (const [key, aliases] of Object.entries(LABELS)) {
        if (aliases.some((a) => label === a || label.startsWith(a))) return { key, value };
    }
    return null;
};

// Extract a Bangladeshi mobile number, normalized to 01XXXXXXXXX.
const extractPhone = (text) => {
    const candidates = text.match(/(?:\+?88)?[\s-]?0?1[\s-]?\d[\s\d-]{7,}/g) || [];
    for (const c of candidates) {
        let digits = c.replace(/\D/g, "");
        if (digits.startsWith("88")) digits = digits.slice(2);
        if (digits.length === 11 && /^01[3-9]\d{8}$/.test(digits)) return digits;
    }
    const all = text.replace(/[^\d]/g, " ");
    const m = all.match(/01[3-9]\d{8}/);
    return m ? m[0] : null;
};

const isPhoneOnly = (line) => {
    const digits = line.replace(/\D/g, "");
    return digits.length >= 9 && line.replace(/[\d\s+\-()]/g, "").length === 0;
};

// Free-form hint words that suggest a line is an address when it has no label.
const ADDRESS_HINTS = [
    "road", "rd", "house", "flat", "block", "sector", "avenue", "lane", "thana", "district", "division", "po", "post",
    ...KNOWN_CITIES,
    ...DHAKA_ZONES,
    "রোড", "বাসা", "বাড়ি", "ব্লক", "সেক্টর", "থানা", "জেলা", "ঢাকা", "চট্টগ্রাম", "সিলেট", "গ্রাম", "ইউনিয়ন", "উপজেলা", "মোড়", "বাজার",
];

const looksLikeAddress = (line) => {
    const low = line.toLowerCase();
    if (ADDRESS_HINTS.some((h) => low.includes(h))) return true;
    return line.split(",").length >= 2 || line.length >= 25;
};

const parseDeliveryDetails = (raw) => {
    const text = normalizeDigits(String(raw || ""));
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const result = { name: null, phone: null, address: null };
    const unlabeled = [];

    for (const line of lines) {
        const labeled = stripLabel(line);
        if (labeled && !result[labeled.key]) {
            result[labeled.key] = labeled.value;
        } else {
            unlabeled.push(line);
        }
    }

    // Phone: prefer a labeled value, else scan the whole message.
    result.phone = extractPhone(result.phone || "") || extractPhone(text);

    // From leftover unlabeled lines, fill address then name.
    if (!result.address) {
        const addrLine = unlabeled.find((l) => looksLikeAddress(l) && !isPhoneOnly(l));
        if (addrLine) result.address = addrLine;
    }
    if (!result.name) {
        const nameLine = unlabeled.find((l) => !isPhoneOnly(l) && l !== result.address && !looksLikeAddress(l) && l.split(/\s+/).length <= 4);
        if (nameLine) result.name = nameLine;
    }
    if (!result.address) {
        const rest = unlabeled.filter((l) => l !== result.name && !isPhoneOnly(l));
        if (rest.length) result.address = rest.sort((a, b) => b.length - a.length)[0];
    }

    // Split the address line into the structured pieces Pathao / our DB need.
    const parsedAddress = parseAddress(result.address || "");

    return {
        name: result.name ? titleCase(result.name) : null,
        phone: result.phone,
        address: parsedAddress.address,
        city: parsedAddress.city,
        zone: parsedAddress.zone,
        area: parsedAddress.area,
        postcode: parsedAddress.postcode,
    };
};

module.exports = { parseDeliveryDetails, parseAddress, normalizeDigits, extractPhone };
