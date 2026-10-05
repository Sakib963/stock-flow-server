const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// The same key tools/build-location-seed.js wrote into alias_key and name_key. Change one, change
// both, or the seeded spellings stop matching.
const location_key = (text) =>
    String(text ?? "")
        .normalize("NFC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");

// How a name sounds, for spellings nobody saved: "Ukhiya" and "Ukhia", "Mohammodpur" and "Mohammadpur". Only
// for Latin letters, and only a fallback when no name or saved spelling matches exactly.
const sound_key = (key) =>
    /^[a-z]+$/.test(key)
        ? key
              .replace(/iy/g, "i")
              .replace(/ee/g, "i")
              .replace(/oo|ou/g, "u")
              .replace(/z/g, "j")
              .replace(/v/g, "b")
              .replace(/ph/g, "f")
              .replace(/(?<=.)o/g, "a")
              .replace(/(.)\1+/g, "$1")
        : null;

// Matching and type-ahead run over memory, never a query per paste (sales REQ-85). Learned areas
// change on another instance too, so the index is also rebuilt after this long.
const TTL_MS = 10 * 60 * 1000;

let index = null;
let loaded_at = 0;
let loading = null;
let generation = 0;

const add_to = (map, key, value) => {
    if (key.length < 2) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
};

const build = async () => {
    const [districts, thanas, post_offices, areas, aliases, usage, settings] = await Promise.all([
        get_data({ text: `SELECT oid, name_en, name_bn, division_oid FROM ${TABLE.DISTRICT} WHERE status = 'Active'`, values: [] }),
        get_data({ text: `SELECT oid, name_en, name_bn, type, postal_code, district_oid FROM ${TABLE.THANA} WHERE status = 'Active'`, values: [] }),
        get_data({ text: `SELECT postal_code, thana_oid FROM ${TABLE.POST_OFFICE} WHERE status = 'Active'`, values: [] }),
        get_data({ text: `SELECT oid, thana_oid, name_en, name_bn, name_key, kind, times_used FROM ${TABLE.AREA} WHERE status = 'Active'`, values: [] }),
        get_data({ text: `SELECT level, location_oid, alias_key FROM ${TABLE.LOCATION_ALIAS}`, values: [] }),
        get_data({ text: `SELECT district_oid, COUNT(*)::int AS orders FROM ${TABLE.ONLINE_ORDER} WHERE district_oid IS NOT NULL GROUP BY district_oid`, values: [] }),
        getSettings(),
    ]);

    const district = new Map(districts.map((d) => [d.oid, { ...d, keys: [location_key(d.name_en), location_key(d.name_bn)] }]));
    const thana = new Map();
    for (const t of thanas) if (district.has(t.district_oid)) thana.set(t.oid, { ...t, keys: [location_key(t.name_en), location_key(t.name_bn)] });

    for (const a of aliases) {
        const owner = a.level === "District" ? district.get(a.location_oid) : thana.get(a.location_oid);
        if (owner) owner.keys.push(a.alias_key);
    }

    const district_by_key = new Map();
    const thana_by_key = new Map();
    for (const d of district.values()) for (const key of d.keys) add_to(district_by_key, key, d.oid);
    for (const t of thana.values()) for (const key of t.keys) add_to(thana_by_key, key, t.oid);
    const district_by_sound = new Map();
    const thana_by_sound = new Map();
    for (const d of district.values()) for (const key of d.keys) add_to(district_by_sound, sound_key(key) ?? "", d.oid);
    for (const t of thana.values()) for (const key of t.keys) add_to(thana_by_sound, sound_key(key) ?? "", t.oid);

    // A union is written "Binodpur Union" but a customer writes "Binodpur".
    const area_by_key = new Map();
    for (const a of areas) {
        if (!thana.has(a.thana_oid)) continue;
        const keys = new Set([a.name_key, location_key(a.name_bn), a.name_key.replace(/union$/, "")]);
        for (const key of keys) add_to(area_by_key, key, a);
    }

    const thanas_by_postcode = new Map();
    for (const p of post_offices) if (thana.has(p.thana_oid)) add_to(thanas_by_postcode, String(p.postal_code).trim(), p.thana_oid);
    for (const t of thana.values()) if (t.postal_code) add_to(thanas_by_postcode, String(t.postal_code).trim(), t.oid);

    // The business's most common district breaks a tie (REQ-84). On a new install with no orders
    // yet, the home district from settings stands in for it.
    const district_orders = new Map(usage.map((u) => [u.district_oid, u.orders]));
    if (!district_orders.size && settings?.home_district_oid) district_orders.set(settings.home_district_oid, 1);

    return { district, thana, district_by_key, thana_by_key, district_by_sound, thana_by_sound, area_by_key, thanas_by_postcode, district_orders };
};

const load = () => {
    if (!loading) {
        const started = generation;
        loading = build()
            .then((built) => {
                index = built;
                // A load that began before an invalidation read the old areas, so it is not fresh.
                loaded_at = started === generation ? Date.now() : 0;
                return built;
            })
            .finally(() => (loading = null));
    }
    return loading;
};

// Building takes seconds over the cloud database, so a stale index keeps answering while the next
// one builds; only the very first request waits.
const location_index = async () => {
    if (!index) return load();
    if (Date.now() - loaded_at >= TTL_MS) load().catch((e) => log.error(`Could not rebuild the location index, serving the previous one: ${e?.message}`));
    return index;
};

// Called after a learned area is written, once its transaction has committed.
const invalidate_location_index = () => {
    generation += 1;
    loaded_at = 0;
};

const reload_location_index = () => {
    invalidate_location_index();
    return load();
};

module.exports = { location_key, sound_key, location_index, invalidate_location_index, reload_location_index };
