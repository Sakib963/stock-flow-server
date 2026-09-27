const { TABLE } = require("../../../../utils/constant");
const { buildCandidates } = require("../../utils/code-generator");

/**
 * The first SKU this name could take that no live product holds, or null when the name has no
 * letters to build one from. `oid` is the product being edited, so its own SKU is not counted as
 * taken. `read` is get_data, or a transaction's, so the create can ask inside its own transaction.
 */
const first_free_sku = async (read, name, oid = null) => {
      const candidates = buildCandidates(name);
      if (!candidates.length) return null;

      const taken = new Set(
            (
                  await read({
                        text: `SELECT upper(btrim(sku)) AS sku FROM ${TABLE.PRODUCT} WHERE is_deleted = FALSE AND upper(btrim(sku)) = ANY($1) AND ($2::text IS NULL OR oid <> $2)`,
                        values: [candidates, oid],
                  })
            ).map((row) => row.sku)
      );
      return candidates.find((candidate) => !taken.has(candidate)) ?? null;
};

module.exports = { first_free_sku };
