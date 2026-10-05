const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { get_data, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");

// The thana must be in the district and a picked area under the thana, or the analytics would count
// a parcel in two places at once.
const check_place = async (tx, { district_oid, thana_oid, area_oid }) => {
    const [place] = await tx.get_data({
        text: `SELECT t.oid, (a.oid IS NOT NULL) AS area_fits
                 FROM ${TABLE.THANA} t
                 JOIN ${TABLE.DISTRICT} d ON d.oid = t.district_oid AND d.status = 'Active'
                 LEFT JOIN ${TABLE.AREA} a ON a.oid = $3 AND a.thana_oid = t.oid AND a.status = 'Active'
                WHERE t.oid = $2 AND t.district_oid = $1 AND t.status = 'Active'`,
        values: [district_oid, thana_oid, area_oid],
    });
    if (!place) fail(400, "That thana or upazila is not in the district picked. Pick the district again, then the thana.", { field: "thana_oid" });
    if (area_oid && !place.area_fits) fail(400, "That area is not under the thana picked. Pick the area again or type it.", { field: "area_oid" });
};

// One default per customer (a partial unique index holds it): the old one steps down first.
const clear_default = (tx, customer_oid, user_id, except_oid = null) =>
    tx.execute_value({
        text: `UPDATE ${TABLE.CUSTOMER_ADDRESS} SET is_default = false, edited_by = $2, edited_on = clock_timestamp()
                WHERE customer_oid = $1 AND is_default AND status = 'Active' AND oid IS DISTINCT FROM $3`,
        values: [customer_oid, user_id, except_oid],
    });

// Every address write locks the customer first, then the address, so two of them queue instead of
// deadlocking. The caller holds that lock before calling this.
const insert_address = async (tx, customer_oid, address, user_id) => {
    await check_place(tx, address);
    const [{ has_default }] = await tx.get_data({
        text: `SELECT EXISTS (SELECT 1 FROM ${TABLE.CUSTOMER_ADDRESS} WHERE customer_oid = $1 AND is_default AND status = 'Active') AS has_default`,
        values: [customer_oid],
    });
    const is_default = address.is_default || !has_default;
    if (is_default) await clear_default(tx, customer_oid, user_id);

    const oid = uuidv4();
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.CUSTOMER_ADDRESS} (oid, customer_oid, label, recipient_name, recipient_phone, address_line, district_oid, thana_oid, area_oid, area_text, postal_code, is_default, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        values: [oid, customer_oid, address.label, address.recipient_name, address.recipient_phone, address.address_line, address.district_oid, address.thana_oid, address.area_oid, address.area_text, address.postal_code, is_default, user_id],
    });
    return { oid, is_default };
};

const describe_address = (address) => [address.label, address.recipient_name, address.address_line].filter(Boolean).join(", ");

const read_addresses = (customer_oid) =>
    get_data({
        text: `SELECT a.oid, a.label, a.recipient_name, a.recipient_phone, a.address_line, a.area_oid, a.area_text, a.postal_code, a.is_default,
                      a.district_oid, d.name_en AS district_name_en, d.name_bn AS district_name_bn,
                      a.thana_oid, t.name_en AS thana_name_en, t.name_bn AS thana_name_bn,
                      ar.name_en AS area_name_en, ar.name_bn AS area_name_bn
                 FROM ${TABLE.CUSTOMER_ADDRESS} a
                 LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = a.district_oid
                 LEFT JOIN ${TABLE.THANA} t ON t.oid = a.thana_oid
                 LEFT JOIN ${TABLE.AREA} ar ON ar.oid = a.area_oid
                WHERE a.customer_oid = $1 AND a.status = 'Active'
                ORDER BY a.is_default DESC, a.created_on DESC, a.oid`,
        values: [customer_oid],
    });

// A counter-only person serves walk-ins and never sends a parcel, so a customer's saved addresses
// stay out of everything they read (decided by the user, 2026-10-04).
const sees_addresses = (channels) => channels.includes("ONLINE");

const ADDRESS_COLUMNS = ["address_line", "district_oid", "district_name_en", "district_name_bn", "thana_oid", "thana_name_en", "thana_name_bn"];
// A counter-only person keeps no addresses either: an answer to a write would tell them what one says.
// Fails closed: a grant that cannot be read is a refusal.
const online_sellers_only = async (request, res, next) => {
    try {
        if (sees_addresses(await channels_of(request))) return next();
    } catch (e) {
        log.error(`Could not read the channels for an address write: ${e?.message}`);
    }
    return res.status(403).json({ code: 403, message: "Addresses are kept by whoever sells online.", data: null });
};

// Address entries in a customer's activity carry the address itself.
const ADDRESS_ACTIVITY = new Set(["Added address", "Updated address", "Removed address"]);
const hides_address_activity = (entry) => !ADDRESS_ACTIVITY.has(entry.title);

const without_address = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !ADDRESS_COLUMNS.includes(key)));

module.exports = { check_place, clear_default, insert_address, describe_address, read_addresses, sees_addresses, without_address, online_sellers_only, hides_address_activity };
