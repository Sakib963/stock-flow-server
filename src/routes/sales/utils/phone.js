// One customer per phone (sales REQ-32, REQ-60): `+8801987654321`, `01987-654321` and `০১৯৮৭৬৫৪৩২১`
// are the same person, so every lookup and every write goes through this first.
const MOBILE = /^01[3-9]\d{8}$/;

const NOT_MOBILE = "This is not a mobile number. Ask the customer for an 11 digit number starting 01";

const normalize_phone = (raw) => {
    if (raw === null || raw === undefined) return null;
    const digits = String(raw)
        .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
        .replace(/[\s\-.()]/g, "")
        .replace(/^\+?88(?=01)/, "");
    return MOBILE.test(digits) ? digits : null;
};

// For Joi's `.custom()`: the schema hands the controller the normalised phone or refuses it.
const joi_phone = (value, helpers) => normalize_phone(value) ?? helpers.message(NOT_MOBILE);

module.exports = { normalize_phone, joi_phone, NOT_MOBILE };
