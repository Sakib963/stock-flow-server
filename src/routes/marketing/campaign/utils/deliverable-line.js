const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { business_today } = require("../../../../utils/business-time");

// Posted and Late carry the day the work went up, today unless given; Pending and Missed carry none.
const POSTED_ON = (status, posted_on) => `CASE WHEN ${status} IN ('Posted', 'Late') THEN COALESCE(${posted_on}::date, ${business_today}) END`;

/**
 * The campaign line a deliverable belongs to, locked, with its campaign and partner names. Deliverables
 * change while the campaign is Planned, Live or Completed, since posts are often checked after the end;
 * a cancelled campaign is a record.
 */
const lock_line = async (tx, { campaign_partner_oid = null, deliverable_oid = null }) => {
    const [line] = await tx.get_data({
        text: `SELECT cp.oid, c.oid AS campaign_oid, c.campaign_no, c.status, pt.name
                 FROM ${TABLE.CAMPAIGN_PARTNER} cp
                 JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
                 JOIN ${TABLE.PARTNER} pt ON pt.oid = cp.partner_oid
                WHERE cp.oid = COALESCE($1, (SELECT d.campaign_partner_oid FROM ${TABLE.CAMPAIGN_DELIVERABLE} d WHERE d.oid = $2))
                FOR UPDATE OF cp`,
        values: [campaign_partner_oid, deliverable_oid],
    });
    if (!line) fail(404, "That partner or promised post is no longer on the campaign. Reload the campaign and try again.");
    if (line.status === "Cancelled") fail(409, `${line.campaign_no} is cancelled, so its promised posts can no longer change.`);
    return line;
};

module.exports = { POSTED_ON, lock_line };
