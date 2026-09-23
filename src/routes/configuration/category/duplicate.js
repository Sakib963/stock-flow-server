// Turns the database's refusal of a duplicate into the response the form needs.
//
// The unique indexes come from 2026-09-23-categories-unique-name-and-code.sql. Reading which index
// refused the write is what lets create and update stop counting rows first: a check-then-insert
// lets two tabs both read zero and both write, and the database is the only thing that can decide
// without a race.

const CONFLICTS = {
      categories_name_unique_ci: {
            field: 'name',
            message: 'A category with this name already exists. Pick another name.',
      },
      categories_category_code_unique_ci: {
            field: 'category_code',
            message: 'A category with this code already exists. Pick another code, or generate one.',
      },
};

const duplicate_conflict = (error) => (error?.code === '23505' ? CONFLICTS[error.constraint] || null : null);

/**
 * Did this insert already land?
 *
 * `execute_value` replays a statement after a dropped connection, and the oid is generated once
 * before that, so a create whose response was lost re-inserts the identical row and the primary key
 * refuses it. That is not a duplicate the person made: it is their own write, already saved.
 */
const already_written = (error) => error?.code === '23505' && error.constraint === 'categories_pkey';

module.exports = { duplicate_conflict, already_written };
