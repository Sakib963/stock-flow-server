const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { VERSION } = require("../../../../db/stale-edit");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { BATCH_BUDGETS, BUDGET_JOIN, costs_of } = require("../utils/campaign-lines");
const { sees_payments } = require("../../utils/sees-payments");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { business_today } = require("../../../../utils/business-time");

const get_campaign_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const [campaign] = await get_data({
            text: `SELECT c.oid, c.campaign_no, c.name, c.promotion_type, c.status,
                          to_char(c.posting_start, 'YYYY-MM-DD') AS posting_start, to_char(c.posting_end, 'YYYY-MM-DD') AS posting_end, to_char(c.measure_end, 'YYYY-MM-DD') AS measure_end,
                          c.ad_spend, c.other_cost, c.other_cost_note, c.note, c.cancel_note,
                          c.created_on, COALESCE(cu.name, c.created_by) AS created_by, c.started_on, c.completed_on, c.cancelled_on, c.${VERSION}
                     FROM ${TABLE.CAMPAIGN} c LEFT JOIN ${TABLE.LOGIN} cu ON cu.email = c.created_by
                    WHERE c.oid = $1`,
            values: [oid],
        });
        if (!campaign) return res.status(404).json({ code: 404, message: "No campaign with that id. It may have been removed.", data: null });

        const [batches, partners, activity, payments_shown, money_shown] = await Promise.all([
            get_data({
                text: `SELECT cb_line.oid, i.oid AS inventory_oid, i.batch_code, p.oid AS product_oid, p.name AS product_name, p.sku,
                              i.initial_quantity::int AS units, i.quantity_available::int AS on_hand, ${BATCH_BUDGETS}
                         FROM ${TABLE.CAMPAIGN_BATCH} cb_line
                         JOIN ${TABLE.INVENTORY} i ON i.oid = cb_line.inventory_oid
                         JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                         ${BUDGET_JOIN}
                        WHERE cb_line.campaign_oid = $1
                        ORDER BY p.name, i.batch_code`,
                values: [oid],
            }),
            get_data({
                text: `SELECT cp.oid, cp.partner_oid, pt.name, pt.partner_type, pt.payment_method, cp.agreed_fee, cp.note,
                              (SELECT COALESCE(SUM(pp.amount), 0)::bigint FROM ${TABLE.PARTNER_PAYMENT} pp WHERE pp.campaign_partner_oid = cp.oid) AS paid,
                              (SELECT COALESCE(json_agg(json_build_object('oid', pp.oid, 'amount', pp.amount, 'paid_on', to_char(pp.paid_on, 'YYYY-MM-DD'), 'payment_method', pp.payment_method, 'reference', pp.reference, 'note', pp.note) ORDER BY pp.paid_on, pp.created_on), '[]'::json)
                                 FROM ${TABLE.PARTNER_PAYMENT} pp WHERE pp.campaign_partner_oid = cp.oid) AS payments,
                              (SELECT COALESCE(json_agg(json_build_object('oid', g.oid, 'giveaway_no', g.giveaway_no, 'status', g.status,
                                                'units', (SELECT COALESCE(SUM(gl.quantity), 0)::int FROM ${TABLE.GIVEAWAY_LINE} gl WHERE gl.giveaway_oid = g.oid),
                                                'cost', (SELECT COALESCE(SUM(gl.quantity * gl.cost_price), 0)::bigint FROM ${TABLE.GIVEAWAY_LINE} gl WHERE gl.giveaway_oid = g.oid)) ORDER BY g.created_on), '[]'::json)
                                 FROM ${TABLE.GIVEAWAY} g WHERE g.campaign_partner_oid = cp.oid) AS giveaways,
                              -- past_due is only a hint (REQ-12): nothing changes the status by itself.
                              (SELECT COALESCE(json_agg(json_build_object('oid', d.oid, 'kind', d.kind, 'quantity', d.quantity, 'due_on', to_char(d.due_on, 'YYYY-MM-DD'), 'status', d.status,
                                                'link', d.link, 'posted_on', to_char(d.posted_on, 'YYYY-MM-DD'), 'note', d.note, 'version', d.xmin::text, 'past_due', d.status = 'Pending' AND d.due_on < ${business_today}) ORDER BY d.due_on, d.created_on), '[]'::json)
                                 FROM ${TABLE.CAMPAIGN_DELIVERABLE} d WHERE d.campaign_partner_oid = cp.oid) AS deliverables
                         FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.PARTNER} pt ON pt.oid = cp.partner_oid
                        WHERE cp.campaign_oid = $1
                        ORDER BY pt.name`,
                values: [oid],
            }),
            getLogActivities("campaign", oid, 5),
            sees_payments(request),
            sees_money(request),
        ]);
        // Paid, owed and each payment only for someone who may see payments to partners.
        // Products given count at cost once Given; the cost is a buying price, so only for someone who may see it.
        const products = money_shown ? partners.flatMap((p) => p.giveaways).filter((g) => g.status === 'Given').reduce((sum, g) => sum + Number(g.cost), 0) : null;
        const lines = partners.map(({ paid, payments, giveaways, ...line }) => {
            const gifts = money_shown ? giveaways : giveaways.map(({ cost, ...gift }) => gift);
            return payments_shown ? { ...line, giveaways: gifts, paid: Number(paid), owed: Math.max(Number(line.agreed_fee) - Number(paid), 0), payments } : { ...line, giveaways: gifts };
        });

        return res.status(200).json({
            code: 200,
            message: "Campaign",
            data: {
                details: campaign,
                batches,
                partners: lines,
                costs: costs_of(campaign, batches, partners, products),
                payments_shown,
                activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
            },
        });
    } catch (e) {
        log.error(`An exception occurred while loading campaign ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the campaign. Try again in a moment." });
    }
};

module.exports = get_campaign_details;
