const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../utils/database");
const { log } = require("../../../utils/log");
const { read_config_version, payload_etag } = require("../../../utils/config-version");

// Everything the shell needs to paint itself, in one round trip: who is signed in, the business
// they belong to, what they may do, and the menu that follows from it. Called on every load and
// refresh with a valid token, so the cost of an unchanged reload is one indexed read and a 304.
//
// A short in-process cache sits in front. It is free on a warm Vercel instance and simply absent on
// a cold one, which is why it is an optimisation and not the mechanism: the ETag is the mechanism.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const get_user_info = async (request, res) => {
    const user_id = request.credentials.user_id;

    try {
        // 1. The cheap question first: who is this, and has anything changed.
        const identity = await get_data({
            text: `SELECT l.name, l.email, l.mobile_number, l.status, l.photo, l.designation, l.edited_on,
                          l.role_oid, r.name AS role_name, r.scope AS role_scope
                   FROM ${TABLE.LOGIN} l
                   LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
                   WHERE l.email = $1`,
            values: [user_id],
        });

        const user = identity[0];
        if (!user) {
            log.warn(`Boot payload requested for an account that no longer exists`);
            return res.status(404).json({ code: 404, message: "This account no longer exists." });
        }

        const configVersion = await read_config_version();
        const etag = payload_etag({ configVersion, roleOid: user.role_oid, userEditedOn: user.edited_on });

        res.set("ETag", etag);
        // Must revalidate on every load: a revoked permission has to take effect at once, so the
        // client may reuse its copy only after asking.
        res.set("Cache-Control", "private, no-cache");

        if (request.headers["if-none-match"] === etag) {
            return res.status(304).end();
        }

        const cached = cache.get(etag);
        if (cached && cached.expires > Date.now()) {
            return res.status(200).json({ code: 200, message: "User info found", data: cached.payload });
        }

        // 2. Only now, having established something changed, do the work.
        const [permissionRows, menuRows, settingsRows] = await Promise.all([
            get_data({
                text: `SELECT p.code FROM ${TABLE.ROLE_PERMISSION} rp
                       JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
                       WHERE rp.role_oid = $1
                       ORDER BY p.sort_order`,
                values: [user.role_oid],
            }),
            get_data({
                text: `SELECT oid, parent_oid, slug, label, label_bn, description_en, description_bn,
                              tags, icon, route, permission_code, sort_order,
                              is_new, is_disabled, disabled_message_en, disabled_message_bn
                       FROM ${TABLE.MENU_ITEM}
                       WHERE status = 'Active'
                       ORDER BY sort_order`,
            }),
            get_data({ text: `SELECT name, logo_url, order_system FROM ${TABLE.SETTINGS} LIMIT 1` }),
        ]);

        const permissions = permissionRows.map((r) => r.code);
        const settings = settingsRows[0] ?? {};

        const payload = {
            version: etag.replace(/"/g, ""),
            user: {
                name: user.name,
                email: user.email,
                mobile_number: user.mobile_number,
                photo: user.photo,
                designation: user.designation,
                role: user.role_name,
                // The client never needs to know a scope exists. It only ever receives what it may
                // see, so there is nothing for it to branch on.
            },
            business: {
                name: settings.name ?? null,
                logoUrl: settings.logo_url ?? null,
                orderSystem: settings.order_system ?? "both",
            },
            permissions,
            menu: build_menu(menuRows, new Set(permissions)),
            counters: { notifications: 0 },
        };

        cache.set(etag, { payload, expires: Date.now() + CACHE_TTL_MS });
        if (cache.size > 200) cache.clear();

        log.info(`Boot payload built for user: ${user.email}`);
        return res.status(200).json({ code: 200, message: "User info found", data: payload });
    } catch (e) {
        log.error(`An exception occurred while getting user information: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

/**
 * Flat rows to a filtered tree.
 *
 * The server filters and the client never does. Sending the whole menu and hiding parts of it
 * client side would put the entire application structure, including the vendor-only system module,
 * in devtools for anyone who looks.
 *
 * A group whose children are all filtered out is dropped whole, so no empty headings survive.
 */
const build_menu = (rows, held) => {
    const visible = (row) => !row.permission_code || held.has(row.permission_code);

    const shape = (row, children) => ({
        id: row.slug,
        label: { en: row.label, bn: row.label_bn || row.label },
        description: { en: row.description_en, bn: row.description_bn },
        tags: row.tags ?? [],
        icon: row.icon,
        order: row.sort_order,
        route: row.route,
        permission: row.permission_code,
        // Present but unusable, and says why. Distinct from absent, which means no permission:
        // hiding a feature someone is allowed to reach would be a lie, and gets reported as a
        // permissions bug.
        isDisabled: row.is_disabled ?? false,
        disabledMessage: { en: row.disabled_message_en, bn: row.disabled_message_bn },
        isNew: row.is_new ?? false,
        children,
    });

    const parents = rows.filter((r) => !r.parent_oid);
    const childrenOf = (oid) => rows.filter((r) => r.parent_oid === oid);

    return parents
        .map((parent) => {
            const children = childrenOf(parent.oid).filter(visible).map((c) => shape(c, []));
            // A leaf is judged on its own permission; a group is judged on whether anything
            // survived inside it.
            const isGroup = childrenOf(parent.oid).length > 0;
            if (isGroup) return children.length ? shape(parent, children) : null;
            return visible(parent) ? shape(parent, []) : null;
        })
        .filter(Boolean);
};

module.exports = get_user_info;
