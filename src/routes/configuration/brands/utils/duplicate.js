// The unique index comes from 2026-09-27-brands-unique-name-export-and-menu.sql.

const CONFLICTS = {
      brands_name_unique_ci: {
            field: 'name',
            message: 'A brand with this name already exists. Pick another name.',
      },
};

const duplicate_conflict = (error) => (error?.code === '23505' ? CONFLICTS[error.constraint] || null : null);

// A replayed insert after a dropped connection hits its own primary key: the write already landed.
const already_written = (error) => error?.code === '23505' && error.constraint === 'brands_pkey';

module.exports = { duplicate_conflict, already_written };
