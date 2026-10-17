const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Records what someone says was paid to a partner on a campaign. No money moves (REQ-09). A payment
// above what is owed is allowed and shown as paid over the fee: the record says what happened.
const create_partner_payment = async (request, res) => {
    const p = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const [line] = await tx.get_data({
                text: `SELECT cp.oid, cp.campaign_oid, cp.agreed_fee, c.campaign_no, c.status, pt.name
                         FROM ${TABLE.CAMPAIGN_PARTNER} cp
                         JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
                         JOIN ${TABLE.PARTNER} pt ON pt.oid = cp.partner_oid
                        WHERE cp.oid = $1 FOR UPDATE OF cp`,
                values: [p.campaign_partner_oid],
            });
            if (!line) fail(404, "That partner is no longer on the campaign. Reload the campaign and try again.");
            if (line.status === "Cancelled") fail(409, `${line.campaign_no} is cancelled, so no payment can be recorded on it.`);

            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.PARTNER_PAYMENT} (oid, campaign_partner_oid, amount, paid_on, payment_method, reference, note, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (oid) DO NOTHING`,
                values: [p.oid, p.campaign_partner_oid, p.amount, p.paid_on, p.payment_method, p.reference, p.note, user_id],
            });
            if (saved.rowCount !== 1) {
                const [earlier] = await tx.get_data({ text: `SELECT campaign_partner_oid, amount FROM ${TABLE.PARTNER_PAYMENT} WHERE oid = $1`, values: [p.oid] });
                if (earlier?.campaign_partner_oid !== line.oid || Number(earlier.amount) !== p.amount) fail(409, "That payment was already recorded with other details. Reload the campaign to see what was saved.");
            }
            const [{ paid }] = await tx.get_data({ text: `SELECT COALESCE(SUM(amount), 0)::bigint AS paid FROM ${TABLE.PARTNER_PAYMENT} WHERE campaign_partner_oid = $1`, values: [line.oid] });
            if (saved.rowCount === 1) {
                // No amount, method or reference: the activity is read by people who may not see payments (REQ-13).
                await saveLogActivity({ reference_type: "campaign", reference_oid: line.campaign_oid, title: "Partner paid", description: `${line.campaign_no}: payment to ${line.name} recorded` }, { tx, request });
            }
            return { campaign_no: line.campaign_no, name: line.name, paid: Number(paid), owed: Math.max(Number(line.agreed_fee) - Number(paid), 0), repeated: saved.rowCount !== 1 };
        });
        if (!outcome.repeated) log.info(`Payment of ${p.amount} to ${outcome.name} on ${outcome.campaign_no} recorded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Payment recorded", data: { oid: p.oid, paid: outcome.paid, owed: outcome.owed } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while recording a partner payment: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not record the payment. Try again in a moment." });
    }
};

module.exports = create_partner_payment;
