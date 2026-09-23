const { get_data } = require("./database");

// The one way a list endpoint reads a page: search, filters, sort and paging from the query string,
// always parameterised, with the count taken over exactly the same filtered set as the rows.
// Contract: stock-flow-documents/docs/list-page/list-page.md, REQ-19.

// A person searching for "50%" means the characters, not a wildcard.
const escape_like = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const build_where = ({ where = [], values = [], search = [], filters = {}, query }) => {
    const clauses = [...where];
    const params = [...values];
    const add = (value) => {
        params.push(value);
        return `$${params.length}`;
    };

    const term = typeof query.search === "string" ? query.search.trim() : "";
    if (term && search.length) {
        const placeholder = add(`%${escape_like(term)}%`);
        clauses.push(`(${search.map((column) => `${column} ILIKE ${placeholder}`).join(" OR ")})`);
    }

    // A comma-separated value is a multi-select: any of them matches.
    for (const [key, column] of Object.entries(filters)) {
        const raw = query[key];
        if (raw === undefined || raw === null || raw === "") continue;
        const picked = String(raw)
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        if (!picked.length) continue;
        clauses.push(picked.length === 1 ? `${column} = ${add(picked[0])}` : `${column} = ANY(${add(picked)})`);
    }

    return { text: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params, add };
};

const wants = (query, part) =>
    String(query.include ?? "")
        .split(",")
        .map((v) => v.trim())
        .includes(part);

// `stats` is a map of SQL aggregate expressions written by the controller, never anything from the
// query string: the only client input here is whether `include` asked for them at all.
const read_list = async ({ select, from, where, values, search, filters, sortable, default_sort, stats, tie_breaker = "oid", query }) => {
    const filtered = build_where({ where, values, search, filters, query });

    // Only a column named in `sortable` can reach ORDER BY. The schema refuses anything else first;
    // an endpoint that forgot the schema is still safe.
    const chosen = query.sort && Object.hasOwn(sortable, query.sort) ? { column: sortable[query.sort], order: query.order } : { column: sortable[default_sort.key], order: default_sort.order };
    const direction = chosen.order === "desc" ? "DESC" : "ASC";

    // Stat cards ride on the count query rather than a second round trip, which is also the only
    // way they cannot disagree with the total: same WHERE, same snapshot, one statement (REQ-19).
    const asked = stats && wants(query, "stats");
    const stat_select = asked ? `, ${Object.entries(stats).map(([key, expression]) => `${expression} AS ${key}`).join(", ")}` : "";

    const count = await get_data({ text: `SELECT COUNT(*)::int AS total${stat_select} FROM ${from} ${filtered.text}`, values: filtered.params });

    const limit = filtered.add(Number(query.limit ?? 20));
    const offset = filtered.add(Number(query.offset ?? 0));
    const rows = await get_data({
        text: `SELECT ${select} FROM ${from} ${filtered.text} ORDER BY ${chosen.column} ${direction}, ${tie_breaker} ASC LIMIT ${limit} OFFSET ${offset}`,
        values: filtered.params,
    });

    const counted = asked ? Object.fromEntries(Object.keys(stats).map((key) => [key, count[0]?.[key] ?? 0])) : null;

    return { rows, total: count[0]?.total ?? 0, stats: counted };
};

module.exports = { read_list, escape_like };
