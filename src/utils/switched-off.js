const { TABLE } = require("./constant");
const { get_data } = require("../db/database");
const { read_config_version } = require("./config-version");

// A feature disabled or hidden in the registry, by itself or through its module, refuses every action
// under it, for everyone, with the nearest reason (a hidden one has none). Features are keyed by their
// code without the action (`inventory.purchase-order`); an off module is keyed by its slug, which is
// the first part of every code in it, so a code with no menu entry of its own (`inventory.stock-value`)
// goes with its module too. Read once per config version, which every registry write raises.
const OFF_SQL = `
    WITH RECURSIVE tree AS (
        SELECT oid, slug, route, parent_oid, permission_code, (is_disabled OR status <> 'Active') AS off,
               CASE WHEN is_disabled THEN disabled_message_en END AS reason_en,
               CASE WHEN is_disabled THEN disabled_message_bn END AS reason_bn
          FROM ${TABLE.MENU_ITEM} WHERE parent_oid IS NULL
        UNION ALL
        SELECT m.oid, m.slug, m.route, m.parent_oid, m.permission_code, t.off OR m.is_disabled OR m.status <> 'Active',
               CASE WHEN m.is_disabled THEN m.disabled_message_en ELSE t.reason_en END,
               CASE WHEN m.is_disabled THEN m.disabled_message_bn ELSE t.reason_bn END
          FROM ${TABLE.MENU_ITEM} m JOIN tree t ON m.parent_oid = t.oid
    )
    SELECT CASE WHEN parent_oid IS NULL AND route IS NULL THEN slug ELSE permission_code END AS code_or_module,
           parent_oid IS NULL AND route IS NULL AS is_module, reason_en, reason_bn
      FROM tree WHERE off AND (permission_code IS NOT NULL OR (parent_oid IS NULL AND route IS NULL))`;

const feature_of = (code) => code.slice(0, code.lastIndexOf("."));

let cached = { version: null, off: null };

const switched_off = async () => {
    const version = await read_config_version();
    if (cached.version === version) return cached.off;
    const rows = await get_data({ text: OFF_SQL });
    const off = new Map(rows.map((r) => [r.is_module ? r.code_or_module : feature_of(r.code_or_module), { en: r.reason_en, bn: r.reason_bn }]));
    cached = { version, off };
    return off;
};

/** The reason a feature is off, its own before its module's; undefined when it is on. */
const off_reason = (off, feature) => off.get(feature) ?? off.get(feature.split(".")[0]);

module.exports = { switched_off, feature_of, off_reason };
