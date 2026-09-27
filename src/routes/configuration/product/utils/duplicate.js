// The unique index comes from 2026-09-27-product-sku-delete-and-menu.sql.

const CONFLICTS = {
      product_sku_unique_ci: {
            field: "sku",
            message: "Another product already has this SKU. Pick another one, or leave it blank to have one made.",
      },
};

const duplicate_conflict = (error) => (error?.code === "23505" ? CONFLICTS[error.constraint] || null : null);

// A replayed insert after a dropped connection hits its own primary key: the write already landed.
const already_written = (error) => error?.code === "23505" && error.constraint === "product_pkey";

module.exports = { duplicate_conflict, already_written };
