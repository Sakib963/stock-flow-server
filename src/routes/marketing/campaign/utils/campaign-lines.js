const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");

// The marketing budgets a campaign is compared with (REQ-07). Packaging is a batch cost, not a promotion's.
const BUDGET_KINDS = ["influencer_cost", "ad_run_cost", "gift_cost", "content_creation_cost"];

const BATCH_BUDGETS = BUDGET_KINDS.map((key) => `COALESCE(cb.${key}, 0)::bigint AS ${key}`).join(", ");
// A batch came from a purchase line or a stock adjustment line; the second is read only without the first, so one batch never matches two budget rows.
const BUDGET_JOIN = `LEFT JOIN ${TABLE.COST_BUDGET} cb ON cb.purchase_details_oid = i.purchase_details_oid OR (i.purchase_details_oid IS NULL AND cb.stock_adjustment_line_oid = i.stock_adjustment_line_oid)`;

/** Replaces the campaign's batches with the given ones, refusing a batch that does not exist. */
const save_batches = async (tx, { campaign_oid, batches, user_id }) => {
    const found = await tx.get_data({ text: `SELECT oid FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`, values: [batches] });
    if (found.length !== batches.length) fail(404, "One of the batches no longer exists. Reload the products and try again.");
    await tx.execute_value({ text: `DELETE FROM ${TABLE.CAMPAIGN_BATCH} WHERE campaign_oid = $1 AND NOT (inventory_oid = ANY($2))`, values: [campaign_oid, batches] });
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.CAMPAIGN_BATCH} (oid, campaign_oid, inventory_oid, created_by)
               SELECT gen_random_uuid()::text, $1, b, $3 FROM unnest($2::text[]) b
               ON CONFLICT (campaign_oid, inventory_oid) DO NOTHING`,
        values: [campaign_oid, batches, user_id],
    });
};

/**
 * Replaces the campaign's partners and returns the names added and taken off, for the activity row.
 * A partner kept on the campaign keeps its row, with its fee and note updated, since payments will
 * point at that row. An inactive partner can stay where they already are, but is never added.
 */
const save_partners = async (tx, { campaign_oid, partners, user_id }) => {
    const oids = partners.map((p) => p.partner_oid);
    const found = oids.length ? await tx.get_data({ text: `SELECT oid, name, status FROM ${TABLE.PARTNER} WHERE oid = ANY($1)`, values: [oids] }) : [];
    if (found.length !== oids.length) fail(404, "One of the partners no longer exists. Reload the partners and try again.");
    const current = await tx.get_data({ text: `SELECT cp.partner_oid, p.name FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.PARTNER} p ON p.oid = cp.partner_oid WHERE cp.campaign_oid = $1`, values: [campaign_oid] });
    const kept = new Set(current.map((c) => c.partner_oid));
    const inactive = found.find((p) => p.status !== "Active" && !kept.has(p.oid));
    if (inactive) fail(409, `${inactive.name} is inactive, so they cannot be added to a campaign. Make them active first.`);

    // A partner who has been paid, given products or promised posts stays: each of those points at their row.
    // The lines are locked first, so a payment arriving now waits and then finds the partner gone, or is seen here.
    await tx.get_data({ text: `SELECT oid FROM ${TABLE.CAMPAIGN_PARTNER} WHERE campaign_oid = $1 FOR UPDATE`, values: [campaign_oid] });
    const [paid] = await tx.get_data({
        text: `SELECT p.name FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.PARTNER} p ON p.oid = cp.partner_oid
                WHERE cp.campaign_oid = $1 AND NOT (cp.partner_oid = ANY($2))
                  AND (EXISTS (SELECT 1 FROM ${TABLE.PARTNER_PAYMENT} pp WHERE pp.campaign_partner_oid = cp.oid)
                       OR EXISTS (SELECT 1 FROM ${TABLE.GIVEAWAY} g WHERE g.campaign_partner_oid = cp.oid)
                       OR EXISTS (SELECT 1 FROM ${TABLE.CAMPAIGN_DELIVERABLE} d WHERE d.campaign_partner_oid = cp.oid))
                LIMIT 1`,
        values: [campaign_oid, oids],
    });
    if (paid) fail(409, `${paid.name} has payments, gifts or promised posts on this campaign, so they cannot be taken off it.`);

    await tx.execute_value({ text: `DELETE FROM ${TABLE.CAMPAIGN_PARTNER} WHERE campaign_oid = $1 AND NOT (partner_oid = ANY($2))`, values: [campaign_oid, oids] });
    for (const p of partners) {
        await tx.execute_value({
            text: `INSERT INTO ${TABLE.CAMPAIGN_PARTNER} (oid, campaign_oid, partner_oid, agreed_fee, note, created_by)
                   VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
                   ON CONFLICT (campaign_oid, partner_oid) DO UPDATE
                      SET agreed_fee = EXCLUDED.agreed_fee, note = EXCLUDED.note, edited_by = EXCLUDED.created_by, edited_on = clock_timestamp()
                    WHERE (${TABLE.CAMPAIGN_PARTNER}.agreed_fee, ${TABLE.CAMPAIGN_PARTNER}.note) IS DISTINCT FROM (EXCLUDED.agreed_fee, EXCLUDED.note)`,
            values: [campaign_oid, p.partner_oid, p.agreed_fee, p.note, user_id],
        });
    }
    return { added: found.filter((p) => !kept.has(p.oid)).map((p) => p.name), removed: current.filter((c) => !oids.includes(c.partner_oid)).map((c) => c.name) };
};

// Which agreed cost answers to which batch budget, for the over budget tip (REQ-08).
const COMPARED = { influencer_cost: "fees", ad_run_cost: "ad_spend", gift_cost: "products" };

/**
 * Planned budget per kind and in all, from each batch's per unit budgets times its units, beside the
 * agreed cost. `products` is the cost of what was given, or null for someone who may not see buying
 * prices; then it is left out of the total too. A kind over its budget names the first promoted batch
 * that carries that budget, so the person can open it; a batch with no budget of that kind gets no tip.
 */
const costs_of = (campaign, batches, partners, products = null) => {
    const planned = Object.fromEntries(BUDGET_KINDS.map((key) => [key, batches.reduce((sum, b) => sum + Number(b[key]) * b.units, 0)]));
    const fees = partners.reduce((sum, p) => sum + Number(p.agreed_fee), 0);
    const ad_spend = campaign.ad_spend === null ? null : Number(campaign.ad_spend);
    const other_cost = campaign.other_cost === null ? null : Number(campaign.other_cost);
    const planned_total = Object.values(planned).reduce((sum, v) => sum + v, 0);
    const agreed = { fees, ad_spend, other_cost, products, total: fees + (ad_spend ?? 0) + (other_cost ?? 0) + (products ?? 0) };
    const over = Object.entries(COMPARED)
        .filter(([kind, key]) => planned[kind] > 0 && agreed[key] !== null && agreed[key] > planned[kind])
        .map(([kind, key]) => {
            const batch = batches.find((b) => Number(b[kind]) > 0);
            return { kind, agreed: agreed[key], planned: planned[kind], over: agreed[key] - planned[kind], product_oid: batch.product_oid, batch_code: batch.batch_code };
        });
    return { planned: { ...planned, total: planned_total }, agreed, difference: agreed.total - planned_total, over };
};

module.exports = { BUDGET_KINDS, BATCH_BUDGETS, BUDGET_JOIN, save_batches, save_partners, costs_of };
