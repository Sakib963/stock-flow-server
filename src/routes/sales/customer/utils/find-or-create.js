const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");

// The customer behind a sale's phone (sales REQ-20, REQ-60): the one who has it, or a new one when
// the phone is new. Two counters adding the same new phone at once both land on one customer: the
// unique index makes the second insert a no-op, and the read after it sees the first.
const find_or_create_customer = async (tx, { phone, name }, request) => {
    const find = () => tx.get_data({ text: `SELECT oid, name, phone_normalized AS phone FROM ${TABLE.CUSTOMERS} WHERE phone_normalized = $1`, values: [phone] });

    const [known] = await find();
    if (known) return known;
    if (!name) fail(400, "This phone is new. Ask the customer's name.", { field: "customer.name" });

    const oid = uuidv4();
    const inserted = await tx.execute_value({
        text: `INSERT INTO ${TABLE.CUSTOMERS} (oid, name, phone, phone_normalized, created_by)
               VALUES ($1, $2, $3, $3, $4)
               ON CONFLICT (phone_normalized) WHERE phone_normalized IS NOT NULL DO NOTHING`,
        values: [oid, name, phone, request.credentials.user_id],
    });
    if (inserted.rowCount === 0) return (await find())[0];

    await saveLogActivity({ reference_type: "customer", reference_oid: oid, title: "Created customer", description: `${name}, ${phone}` }, { tx, request });
    return { oid, name, phone };
};

module.exports = { find_or_create_customer };
