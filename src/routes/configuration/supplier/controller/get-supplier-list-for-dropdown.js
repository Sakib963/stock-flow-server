const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// last_ordered_on leaves out drafts, never sent, and cancelled orders, which bought nothing.
const DROPDOWN_SQL = {
      text: `SELECT s.oid AS value, s.name AS label, s.phone_number,
                    (SELECT MAX(p.created_on) FROM ${TABLE.PURCHASE} p WHERE p.supplier_oid = s.oid AND p.status IN ('Submitted', 'Verified')) AS last_ordered_on
             FROM ${TABLE.SUPPLIER} s WHERE s.status = 'Active' ORDER BY s.name ASC`,
      values: [],
};

const get_supplier_list_for_dropdown = async (request, res) => {
      try {
            const data = await get_data(DROPDOWN_SQL);

            return res.status(200).json({
                  code: 200,
                  message: "Supplier list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting supplier list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load suppliers. Try again in a moment." });
      }
};

module.exports = get_supplier_list_for_dropdown;
