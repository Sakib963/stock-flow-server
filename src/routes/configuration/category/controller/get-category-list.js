const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../utils/list-query");
const { log } = require("../../../../utils/log");

// created_by and edited_by hold the person's email, so the row carries who last touched it resolved
// through login: edited_by when the row has been edited, created_by otherwise, with the same
// COALESCE on the timestamp so the name and the time agree.
//
// The role comes from the role table through role_oid, not from login.role: that column is a legacy
// free-text label nothing checks, so it can say Manager for someone whose actual role grants
// something else, and a person card that contradicts access control is worse than one with no role.
//
// The photo is left out on purpose: it is stored as a data URL and twenty of them would weigh more
// than the rest of the page.
const SELECT = `c.oid, c.name, c.description, c.category_code, c.status, c.created_on,
                COALESCE(c.edited_on, c.created_on) AS last_action_on,
                COALESCE(c.edited_by, c.created_by) AS last_action_by,
                (c.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.CATEGORIES} c
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(c.edited_by, c.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

// Counted over the same filtered set as the rows, so a card and the list can never disagree. With
// a status filter applied the other card reads 0, which is the truthful answer to "how many of
// these are inactive" once "these" has been narrowed.
//
// There is no card for the total: the page header already shows it beside the title, and a card
// repeating it would spend a quarter of the strip saying nothing new. These four each answer a
// different question, and "without products" is the one that finds an unfinished setup.
//
// Deleted products are excluded, the way every other product count in the app excludes them.
// Counting them would report a category as stocked when its last product had been removed.
const STATS = {
    active: `COUNT(*) FILTER (WHERE c.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE c.status = 'Inactive')::int`,
    products: `COALESCE(SUM((SELECT COUNT(*) FROM ${TABLE.PRODUCT} p WHERE p.category_oid = c.oid AND p.is_deleted = FALSE)), 0)::int`,
    empty: `COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.category_oid = c.oid AND p.is_deleted = FALSE))::int`,
};

const get_category_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["c.name", "c.category_code", "c.description"],
            filters: { status: "c.status" },
            sortable: { name: "c.name", category_code: "c.category_code", status: "c.status", created_on: "c.created_on", last_action_on: "COALESCE(c.edited_on, c.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "c.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Categories", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing categories: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load categories. Try again in a moment." });
    }
};

module.exports = get_category_list;
