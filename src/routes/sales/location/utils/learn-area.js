const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { location_key } = require("./location-index");

/**
 * Counts one more use of an area under a thana or upazila (sales REQ-83), inside the caller's
 * transaction, and returns its oid. A union of that name is counted rather than shadowed by a
 * learned twin. The caller invalidates the location index once the transaction has committed.
 */
const learn_area = async (tx, { thana_oid, name, user_id }) => {
    const name_key = location_key(name);
    if (name_key.length < 3) return null;

    const union = await tx.execute_value({
        text: `UPDATE ${TABLE.AREA} SET times_used = times_used + 1, edited_by = $3, edited_on = clock_timestamp()
                WHERE oid = (SELECT oid FROM ${TABLE.AREA} WHERE thana_oid = $1 AND name_key = $2 AND kind = 'Union' AND status = 'Active' ORDER BY oid LIMIT 1)
            RETURNING oid`,
        values: [thana_oid, name_key, user_id],
    });
    if (union.rowCount) return union.rows[0].oid;

    // The unique index on (thana_oid, name_key) for learned rows makes two orders learning the same
    // area at once count twice on one row instead of writing two rows.
    const learned = await tx.execute_value({
        text: `INSERT INTO ${TABLE.AREA} (oid, thana_oid, name_en, name_key, kind, times_used, created_by)
               VALUES ($1, $2, $3, $4, 'Learned', 1, $5)
               ON CONFLICT (thana_oid, name_key) WHERE kind = 'Learned'
               DO UPDATE SET times_used = ${TABLE.AREA}.times_used + 1, edited_by = EXCLUDED.created_by, edited_on = clock_timestamp()
               RETURNING oid`,
        values: [uuidv4(), thana_oid, String(name).trim().replace(/\s+/g, " "), name_key, user_id],
    });
    return learned.rows[0].oid;
};

module.exports = { learn_area };
