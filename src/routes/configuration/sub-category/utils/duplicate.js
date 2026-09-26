// Turns the database's refusal of a sub-category write into the response the form needs.
//
// The unique indexes come from 2026-09-26-sub-categories-unique-name-and-code.sql: a name is unique
// within its parent category, a code across every sub-category. The foreign key is the parent.

const CONFLICTS = {
      sub_categories_name_unique_ci: {
            field: "name",
            message: "This category already has a sub-category with this name. Pick another name.",
      },
      sub_categories_category_code_unique_ci: {
            field: "category_code",
            message: "A sub-category with this code already exists. Pick another code, or generate one.",
      },
};

const duplicate_conflict = (error) => (error?.code === "23505" ? CONFLICTS[error.constraint] || null : null);

/** A create whose response was lost and was replayed: its own row, already saved. */
const already_written = (error) => error?.code === "23505" && error.constraint === "sub_categories_pkey";

module.exports = { duplicate_conflict, already_written };
