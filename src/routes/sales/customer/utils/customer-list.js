const { TABLE } = require("../../../../utils/constant");

// One definition for the list and its Excel download, so the file holds exactly the rows the
// person filtered to. The district is the default address's: where the customer usually receives.
const LIST = {
    select: `c.oid, c.name, c.phone, c.gender, c.age_band, c.flag, c.flag_reason, c.status, c.created_on,
             c.first_source_oid, s.name AS first_source_name, s.platform AS first_source_platform,
             a.address_line, a.district_oid, d.name_en AS district_name_en, d.name_bn AS district_name_bn,
             a.thana_oid, t.name_en AS thana_name_en, t.name_bn AS thana_name_bn,
             COALESCE(c.edited_on, c.created_on) AS last_action_on,
             COALESCE(c.edited_by, c.created_by) AS last_action_by,
             (c.edited_by IS NOT NULL) AS last_action_is_edit,
             u.name AS last_action_by_name,
             r.name AS last_action_by_role`,
    from: `${TABLE.CUSTOMERS} c
           LEFT JOIN ${TABLE.CUSTOMER_ADDRESS} a ON a.customer_oid = c.oid AND a.is_default AND a.status = 'Active'
           LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = a.district_oid
           LEFT JOIN ${TABLE.THANA} t ON t.oid = a.thana_oid
           LEFT JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = c.first_source_oid
           LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(c.edited_by, c.created_by)
           LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`,
    search: ["c.name", "c.phone", "c.phone_normalized"],
    filters: {
        status: "c.status",
        flag: "c.flag",
        gender: "COALESCE(c.gender, 'unknown')",
        age_band: "COALESCE(c.age_band, 'unknown')",
        district: "a.district_oid",
        source: "c.first_source_oid",
    },
    sortable: { name: "c.name", phone: "c.phone", created_on: "c.created_on", last_action_on: "COALESCE(c.edited_on, c.created_on)" },
    default_sort: { key: "name", order: "asc" },
    tie_breaker: "c.oid",
};

const STATS = {
    active: `COUNT(*) FILTER (WHERE c.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE c.status = 'Inactive')::int`,
    watch: `COUNT(*) FILTER (WHERE c.flag = 'Watch')::int`,
    blocked: `COUNT(*) FILTER (WHERE c.flag = 'Blocked')::int`,
};

const AGE_BAND_LABEL = { under_18: "Under 18", "18_24": "18 to 24", "25_34": "25 to 34", "35_44": "35 to 44", "45_plus": "45 and over" };

module.exports = { LIST, STATS, AGE_BAND_LABEL };
