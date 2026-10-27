const { TABLE } = require("../../../../utils/constant");
const { read_choices } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Last ordered is when an order was sent, not when its draft was started; drafts and cancelled orders bought nothing.
// Picking offers active suppliers only; naming by oids takes any, so an old order still shows its supplier.
const get_supplier_list_for_dropdown = async (request, res) => {
      try {
            const data = await read_choices({
                  select: `s.oid AS value, s.name AS label, s.phone_number,
                           (SELECT MAX(p.submitted_on) FROM ${TABLE.PURCHASE} p WHERE p.supplier_oid = s.oid AND p.status IN ('Submitted', 'Verified')) AS last_ordered_on`,
                  from: `${TABLE.SUPPLIER} s`,
                  key: "s.oid",
                  where: request.query.oids ? [] : ["s.status = 'Active'"],
                  search: ["s.name", "s.phone_number"],
                  order: "s.name",
                  query: request.query,
            });
            return res.status(200).json({ code: 200, message: "Suppliers", data });
      } catch (e) {
            log.error(`An exception occurred while loading suppliers for a dropdown: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load suppliers. Try again in a moment." });
      }
};

module.exports = get_supplier_list_for_dropdown;
