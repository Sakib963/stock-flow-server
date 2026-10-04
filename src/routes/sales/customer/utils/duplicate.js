const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

// The unique index on phone_normalized decides, not a count first: two people saving the same new
// customer at once would both count zero. The answer names the customer who has the phone, so the
// person opens that record instead of guessing (sales REQ-60).
const phone_taken = (error) => error?.code === "23505" && error.constraint === "uq_customers_phone_normalized";

const phone_conflict = async (phone) => {
    const [owner] = await get_data({ text: `SELECT oid, name FROM ${TABLE.CUSTOMERS} WHERE phone_normalized = $1`, values: [phone] });
    return {
        code: 409,
        message: owner ? `This phone already belongs to ${owner.name}. Open their record instead.` : "This phone already belongs to another customer.",
        data: { field: "phone", customer: owner ?? null },
    };
};

module.exports = { phone_taken, phone_conflict };
