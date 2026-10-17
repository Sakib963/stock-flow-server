const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { business_number } = require("../../../../utils/business-time");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Saves a gift on its own as a Draft, which moves nothing; Give takes the stock. The oid is made by
// the client, so a request repeated after a lost answer finds the draft it already saved.
const create_giveaway = async (request, res) => {
    const { oid, recipient_name, recipient_phone, address_line, note, campaign_partner_oid, lines } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const batches = await tx.get_data({
                text: `SELECT i.oid, i.product_oid, i.cost_price::int AS cost_price
                         FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                        WHERE i.oid = ANY($1) AND COALESCE(p.is_deleted, false) = false`,
                values: [lines.map((line) => line.inventory_oid)],
            });
            if (batches.length !== lines.length) fail(409, "A product on this gift was deleted or its batch no longer exists. Remove it and pick again.");
            const [customer] = recipient_phone ? await tx.get_data({ text: `SELECT oid FROM ${TABLE.CUSTOMERS} WHERE phone_normalized = $1`, values: [recipient_phone] }) : [];

            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.GIVEAWAY} (oid, giveaway_no, customer_oid, recipient_name, recipient_phone, address_line, note, campaign_partner_oid, status, created_by)
                       VALUES ($1, ${business_number("GFT", "giveaway_number_seq")}, $2, $3, $4, $5, $6, $8, 'Draft', $7)
                       ON CONFLICT (oid) DO NOTHING RETURNING giveaway_no`,
                values: [oid, customer?.oid ?? null, recipient_name, recipient_phone, address_line, note, user_id, campaign_partner_oid],
            });
            if (saved.rowCount !== 1) {
                const [already] = await tx.get_data({ text: `SELECT giveaway_no, created_by FROM ${TABLE.GIVEAWAY} WHERE oid = $1`, values: [oid] });
                if (already?.created_by !== user_id) fail(409, "That giveaway number is already taken. Reload the page and try again.");
                return { giveaway_no: already.giveaway_no, repeated: true };
            }
            const { giveaway_no } = saved.rows[0];
            // Checked only for a new draft, so a retry after the campaign closed still finds the draft it saved.
            if (campaign_partner_oid) {
                const [line] = await tx.get_data({
                    text: `SELECT c.campaign_no, c.status FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid WHERE cp.oid = $1 FOR SHARE OF cp, c`,
                    values: [campaign_partner_oid],
                });
                if (!line) fail(404, "That partner is no longer on the campaign. Open the campaign again.");
                if (!["Planned", "Live"].includes(line.status)) fail(409, `${line.campaign_no} is ${line.status.toLowerCase()}, so nothing more can be given for it.`);
            }
            const by_oid = new Map(batches.map((batch) => [batch.oid, batch]));
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.GIVEAWAY_LINE} (oid, giveaway_oid, inventory_oid, product_oid, quantity, cost_price)
                       SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::int[], $6::numeric[])`,
                values: [lines.map(() => uuidv4()), lines.map(() => oid), lines.map((line) => line.inventory_oid), lines.map((line) => by_oid.get(line.inventory_oid).product_oid), lines.map((line) => line.quantity), lines.map((line) => by_oid.get(line.inventory_oid).cost_price)],
            });
            await saveLogActivity({ reference_type: "giveaway", reference_oid: oid, title: "Giveaway saved", description: `${giveaway_no} to ${recipient_name}, ${lines.length} line(s)` }, { tx, request });
            return { giveaway_no, repeated: false };
        });
        if (!outcome.repeated) log.info(`Giveaway ${outcome.giveaway_no} saved by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Giveaway saved", data: { oid, giveaway_no: outcome.giveaway_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while saving a giveaway: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The giveaway was not saved. Try again in a moment." });
    }
};

module.exports = create_giveaway;
