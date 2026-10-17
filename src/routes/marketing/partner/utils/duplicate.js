// The unique index comes from 2026-10-17-marketing-partners.sql.
const NAME_TAKEN = { field: "name", message: "A partner with this name already exists. Open that partner, or add something to tell them apart." };

const duplicate_name = (error) => (error?.code === "23505" && error.constraint === "partner_name_unique_ci" ? NAME_TAKEN : null);

module.exports = { duplicate_name };
