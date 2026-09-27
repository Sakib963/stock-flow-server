// The unique indexes come from 2026-09-27-supplier-contact-and-promised-date.sql.

const CONFLICTS = {
      supplier_name_unique_ci: {
            field: 'name',
            message: 'A supplier with this name already exists. Pick another name.',
      },
      supplier_phone_unique: {
            field: 'phone_number',
            message: 'Another supplier already has this phone number.',
      },
};

const duplicate_conflict = (error) => (error?.code === '23505' ? CONFLICTS[error.constraint] || null : null);

// A replayed insert after a dropped connection hits its own primary key: the write already landed.
const already_written = (error) => error?.code === '23505' && error.constraint === 'supplier_pkey';

module.exports = { duplicate_conflict, already_written };
