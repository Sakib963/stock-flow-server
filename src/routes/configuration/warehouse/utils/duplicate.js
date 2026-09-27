// The unique indexes come from 2026-09-27-warehouse-unique-and-capacity-units.sql.

const CONFLICTS = {
      warehouse_name_unique_ci: {
            field: 'name',
            message: 'A warehouse with this name already exists. Pick another name.',
      },
      warehouse_code_unique_ci: {
            field: 'code',
            message: 'A warehouse with this code already exists. Pick another code, or generate one.',
      },
};

const duplicate_conflict = (error) => (error?.code === '23505' ? CONFLICTS[error.constraint] || null : null);

// A replayed insert after a dropped connection hits its own primary key: the write already landed.
const already_written = (error) => error?.code === '23505' && error.constraint === 'warehouse_pkey';

module.exports = { duplicate_conflict, already_written };
