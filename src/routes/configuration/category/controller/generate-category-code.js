const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { buildCandidates } = require("../code-generator");

const generate_category_code = async (request, res) => {
      const { name, oid } = request.query;
      const candidates = buildCandidates(name);

      if (!candidates.length) {
            log.warn(`No category code could be built from the given name`);
            return res.status(400).json({ code: 400, message: "This name has no letters to build a code from. Type a code yourself." });
      }

      try {
            // One query for every candidate, rather than one per candidate until something is free.
            const sql = {
                  text: `SELECT upper(btrim(category_code)) AS code FROM ${TABLE.CATEGORIES} WHERE upper(btrim(category_code)) = ANY($1) AND ($2::text IS NULL OR oid <> $2)`,
                  values: [candidates, oid || null],
            };
            const taken = new Set((await get_data(sql)).map((row) => row.code));
            const category_code = candidates.find((candidate) => !taken.has(candidate));

            if (!category_code) {
                  log.warn(`Every candidate code for this name is already taken`);
                  return res.status(409).json({ code: 409, message: "Every code this name could take is already in use. Type a code yourself." });
            }

            return res.status(200).json({
                  code: 200,
                  message: "OK",
                  data: { category_code },
            });
      } catch (e) {
            log.error(`An exception occurred while generating a category code : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = generate_category_code
