const { TABLE } = require("../../../utils/constant");
const { business_day_start } = require("../../../utils/business-time");
const { escape_like } = require("../../../db/list-query");

// What each kind of activity row is about: the area of the app it belongs to, and the table its
// reference_oid points into, so the page can link to a record that still exists and leave a deleted
// one as text. A kind not listed here (an old row from a feature since rebuilt) falls under "other".
const KINDS = {
    order: { area: "sales", table: TABLE.ORDERS },
    customer: { area: "sales", table: TABLE.CUSTOMERS },
    giveaway: { area: "sales", table: TABLE.GIVEAWAY },
    pre_order: { area: "sales", table: TABLE.PRE_ORDERS },
    "pre-order": { area: "sales", table: TABLE.PRE_ORDERS },
    "delivery-batch": { area: "sales", table: TABLE.DELIVERY_BATCH },
    "product-return": { area: "sales", table: TABLE.PRODUCT_RETURN },
    "message-template": { area: "sales" },
    "purchase-order": { area: "inventory", table: TABLE.PURCHASE },
    purchase: { area: "inventory", table: TABLE.PURCHASE },
    "product-dispose": { area: "inventory", table: TABLE.PRODUCT_DISPOSE },
    "stock-adjustment": { area: "inventory", table: TABLE.STOCK_ADJUSTMENT },
    "product-stock": { area: "inventory", table: TABLE.PRODUCT },
    product: { area: "configuration", table: TABLE.PRODUCT },
    brand: { area: "configuration", table: TABLE.BRANDS },
    category: { area: "configuration", table: TABLE.CATEGORIES },
    "sub-category": { area: "configuration", table: TABLE.SUB_CATEGORIES },
    supplier: { area: "configuration", table: TABLE.SUPPLIER },
    warehouse: { area: "configuration", table: TABLE.WAREHOUSE },
    aisle: { area: "configuration", table: TABLE.AISLE },
    settings: { area: "settings" },
    auth: { area: "security" },
    user: { area: "security" },
    role: { area: "security" },
};

const AREAS = ["sales", "inventory", "configuration", "settings", "security", "other"];

const literal = (text) => `'${text.replace(/'/g, "''")}'`;

/** The area of a row, as SQL, so it can be filtered and counted where the rows are. */
const AREA = `CASE a.reference_type ${Object.entries(KINDS)
    .map(([kind, { area }]) => `WHEN ${literal(kind)} THEN ${literal(area)}`)
    .join(" ")} ELSE 'other' END`;

/** Whether the record a row points at still exists, so a deleted one is not offered as a link. */
const RECORD_EXISTS = `CASE a.reference_type ${Object.entries(KINDS)
    .filter(([, kind]) => kind.table)
    .map(([kind, { table }]) => `WHEN ${literal(kind)} THEN EXISTS (SELECT 1 FROM ${table} r WHERE r.oid = a.reference_oid)`)
    .join(" ")} ELSE false END`;

// What an owner would want to see twice: the moments money is given back or stock leaves without a
// sale, a sale called off, something deleted, and changes to the business or to someone's sign-in.
// Only the moment that changes something: a disposal when it is approved, not each step before it.
// Read from the kind and the words of the title the server wrote, so a new controller is caught by
// its words. On the development data this is about one entry in ten.
const WATCHED_KINDS = ["settings", "auth", "user", "role"];
const WATCHED_WORDS = ["cancel", "refund", "delete", "removed", "not delivered", "written off"];
// A document that moves stock only at one step counts at that step alone: a draft cancelled moved nothing.
const WATCHED_STEPS = {
    "stock-adjustment": ["verif"],
    "product-dispose": ["approv", "revers"],
    "product-return": ["confirm"],
};
const stepped = Object.keys(WATCHED_STEPS).map(literal).join(", ");
const ATTENTION = `(a.reference_type IN (${WATCHED_KINDS.map(literal).join(", ")})
    OR (a.reference_type NOT IN (${stepped}) AND (${WATCHED_WORDS.map((word) => `a.title ILIKE ${literal(`%${word}%`)}`).join(" OR ")}))
    OR ${Object.entries(WATCHED_STEPS)
        .flatMap(([kind, words]) => words.map((word) => `(a.reference_type = ${literal(kind)} AND a.title ILIKE ${literal(`%${word}%`)})`))
        .join(" OR ")})`;

/**
 * The WHERE both endpoints share, so the summary always counts exactly the rows the feed shows:
 * the business days chosen (kept index friendly by comparing to each day's start), the person,
 * the area, only what is worth a look, and a search over the title, the description and the name.
 */
const activity_where = (query) => {
    // A guest's visit is the vendor's to watch, from the request log, not the business's.
    const clauses = ["l.is_guest IS NOT TRUE"];
    const values = [];
    const add = (value) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.date_from) clauses.push(`a.performed_on >= ${business_day_start(`${add(query.date_from)}::date`)}`);
    if (query.date_to) clauses.push(`a.performed_on < ${business_day_start(`${add(query.date_to)}::date + 1`)}`);
    if (query.person) clauses.push(`a.performed_by = ${add(query.person)}`);
    if (query.area) clauses.push(`${AREA} = ANY(${add(String(query.area).split(","))})`);
    if (query.attention === "true") clauses.push(ATTENTION);
    const term = typeof query.search === "string" ? query.search.trim() : "";
    if (term) {
        const like = add(`%${escape_like(term)}%`);
        clauses.push(`(a.title ILIKE ${like} OR a.description ILIKE ${like} OR l.name ILIKE ${like} OR a.performed_by ILIKE ${like})`);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
};

const FROM = `${TABLE.ACTIVITY_LOG} a LEFT JOIN ${TABLE.LOGIN} l ON l.email = a.performed_by`;

// The request log keeps the device as JSON text; a row from before it existed has none.
const parse_device = (text) => {
    if (!text) return null;
    try {
        const device = JSON.parse(text);
        return device && typeof device === "object" ? device : null;
    } catch {
        return null;
    }
};

module.exports = { KINDS, AREAS, AREA, ATTENTION, RECORD_EXISTS, FROM, activity_where, parse_device };
