const { TABLE } = require("../../../../utils/constant");

// A registry entry is a menu_item row: a module when it has no route, otherwise a feature. Its module
// is its parent, and a feature in a hidden or disabled module is hidden or disabled with it.
const FROM = `${TABLE.MENU_ITEM} m
              LEFT JOIN ${TABLE.MENU_ITEM} p ON p.oid = m.parent_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(m.edited_by, m.created_by)`;

// A row's own state, before its module's.
const OWN_STATE = `(CASE WHEN m.status <> 'Active' THEN 'Hidden' WHEN m.is_disabled THEN 'Disabled' ELSE 'On' END)`;

const KIND = `(CASE WHEN m.route IS NULL THEN 'Module' ELSE 'Feature' END)`;

// Hidden is status Inactive, which the menu already leaves out; Disabled is shown greyed with its reason.
const STATE = `(CASE WHEN m.status <> 'Active' OR COALESCE(p.status <> 'Active', false) THEN 'Hidden'
                     WHEN m.is_disabled OR COALESCE(p.is_disabled, false) THEN 'Disabled'
                     ELSE 'On' END)`;

// The System module is how a feature is switched back on, so it and its pages are always on.
const LOCKED = `(m.slug = 'system' OR COALESCE(p.slug = 'system', false))`;

module.exports = { FROM, KIND, STATE, OWN_STATE, LOCKED };
