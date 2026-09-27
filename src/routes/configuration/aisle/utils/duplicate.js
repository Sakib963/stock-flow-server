// The unique indexes come from 2026-09-27-aisle-unique-storage-capacity-export-menu.sql.

const CONFLICTS = {
      aisle_name_unique_ci: {
            field: 'name',
            message: 'This warehouse already has an aisle with this name. Pick another name.',
      },
      aisle_code_unique_ci: {
            field: 'code',
            message: 'An aisle with this code already exists. Pick another code, or generate one.',
      },
};

const duplicate_conflict = (error) => (error?.code === '23505' ? CONFLICTS[error.constraint] || null : null);

// A replayed insert after a dropped connection hits its own primary key: the write already landed.
const already_written = (error) => error?.code === '23505' && error.constraint === 'aisle_pkey';

module.exports = { duplicate_conflict, already_written };
