const { TABLE } = require("../../../../utils/constant");
const { read_choices } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Active partners only: an inactive one stays on the campaigns it was on, but is not offered for new ones.
// Naming by oids takes any, so a campaign still shows a partner made inactive since. Partners already on the
// campaign are left out by the server, so a page is never emptied by them after paging.
const get_partners_for_campaign = async (request, res) => {
    try {
        const { oids, exclude } = request.query;
        const where = oids ? [] : ["p.status = 'Active'"];
        const values = [];
        if (exclude) {
            values.push(exclude.split(","));
            where.push(`NOT (p.oid = ANY($${values.length}))`);
        }
        const rows = await read_choices({
            select: "p.oid, p.oid AS value, p.name, p.partner_type, p.platforms, p.handle",
            from: `${TABLE.PARTNER} p`,
            key: "p.oid",
            where,
            values,
            search: ["p.name", "p.handle"],
            order: "p.name",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Partners", data: rows });
    } catch (e) {
        log.error(`An exception occurred while listing partners for a campaign: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the partners. Try again in a moment." });
    }
};

module.exports = get_partners_for_campaign;
